# Debugging the Ghost in the Machine: My Journey building Observability for AI Agents

*AI agents feel like black boxes. When something goes wrong, it's difficult to know whether retrieval, tools, validation, or the LLM caused the issue.*

If you have ever built an LLM-powered application, you have likely encountered this frustration. One minute your agent is outputting flawless JSON, and the next, it's spitting out empty strings, hallucinated data, or throwing silent errors somewhere in a nested API call. 

This is the story of how I set out to solve this problem by integrating OpenTelemetry and SigNoz into a modular AI agent pipeline, shifting from mock behaviors to a production-grade, self-correcting assistant.

---

## Why I Joined the Hackathon

I joined the SigNoz hackathon because I wanted to build something beyond standard CRUD apps. I wanted to see if the tools we use to monitor microservices could help tame the unpredictable nature of AI. 

When we write standard code, we trace executions via stack traces. But with agents, execution is non-linear. An agent might query a vector database, call a tool, validate the response against a schema, fail, retry, and eventually generate an answer. I wanted to build a dashboard where developers could visually replay these decisions, compare execution runs, and let AI explain telemetry anomalies without inventing metrics.

---

## My First Understanding of AI Observability

Initially, my definition of observability was basic. I thought "observability" just meant writing execution timestamps and error statements to a SQL database and pulling them into a frontend list.

My initial playground setup tracked state metrics using a simple schema:
```python
class AgentState(TypedDict):
    trace_id: str
    prompt: str
    nodes_executed: List[str]
    retries: int
    errors: int
    cost: float
    tokens: int
    weather_info: str
    has_failed: bool
```
I recorded node start and completion events, which allowed me to build a simple Gantt chart showing execution steps. While it was satisfying to see execution events line up, I quickly realized this isn't real observability. If a connection was dropped or a vector search took 2 seconds instead of 50ms, my database log didn't tell me *why* it happened. I was monitoring the *results* of the application, not tracing the *behavior* of the system.

---

## What Confused Me Initially

When I began exploring distributed tracing, I hit a wall. 

I was confused by how spans, contexts, and context propagation worked inside an asynchronous LangGraph execution. In a normal HTTP pipeline, context propagation is automatic. But in a graph-based state framework where nodes run asynchronously and loop back on failure, standard span lifecycle hooks would break or lose their parent reference.

I struggled with tracing validation failures. If a response failed validation and looped back to try again, how could I represent that recursion in a standard Gantt waterfall? Should it be a new span, or a child span of the same node? 

This is when I realized I needed a standardized observability framework to handle these metrics.

---

## How I Explored OpenTelemetry and SigNoz

To bridge this gap, I integrated a Dockerized SigNoz collector stack locally. I configured a multi-container environment running ClickHouse for data storage, an OTel collector to receive telemetry on port `4317`, and the SigNoz frontend console at port `3301`.

Here is the Docker Compose setup I implemented for the SigNoz services:

```yaml
services:
  clickhouse:
    image: clickhouse/clickhouse-server:24.1-alpine
    container_name: signoz-clickhouse
    # clickhouse configuration and volumes...

  query-service:
    image: signoz/signoz-query-service:0.35.0
    container_name: signoz-query-service
    # environment connections...

  otel-collector:
    image: signoz/signoz-otel-collector:0.88.3
    container_name: signoz-otel-collector
    command: ["--config=/etc/otel-collector-config.yaml"]
    volumes:
      - ./otel-collector-config.yaml:/etc/otel-collector-config.yaml
    ports:
      - "4317:4317" # OTLP gRPC receiver
```

On the backend, I initialized an OpenTelemetry tracer. By wrapping node executions in active span contexts, I was able to record metadata directly inside standard telemetry traces:

```python
async def run_node_with_telemetry(state: AgentState, node_name: str, logic_fn):
    with tracer.start_as_current_span(node_name) as span:
        span.set_attribute("agent.trace_id", state["trace_id"])
        span.set_attribute("agent.node_name", node_name)
        try:
            output, cost_delta, token_delta = await logic_fn(state)
            span.set_attribute("agent.node_status", "success")
            span.set_attribute("gen_ai.usage.total_tokens", token_delta)
            return output
        except Exception as e:
            span.set_attribute("agent.node_status", "failed")
            span.record_exception(e)
            raise e
```

Now, when a node executed, it generated a span payload containing tokens, cost, and execution status. These spans flowed directly to the OTel collector, linking our AI application metrics to the rest of the stack.

---

## How I Gradually Understood Replay, Traces, Validation, and Retrieval

With the telemetry foundation in place, the project evolved into three main integrations:

### 1. The ChromaDB Retrieval Layer
To test retrieval metrics, I set up a local ChromaDB collection using Gemini embeddings (`models/embedding-001`). I wrote a startup script that dynamically scans a directory of Markdown documents (like operational guidelines and weather policies), chunks them, and embeds them into the local vector store.

When a query runs, the retriever matches relevant chunks and outputs a structured `RETRIEVAL_COMPLETED` event containing document metrics:

```json
{
  "node_name": "Retriever (ChromaDB)",
  "latency_ms": 112,
  "model": "models/embedding-001",
  "document_count": 3,
  "documents": [
    {
      "source_file": "weather_policy.md",
      "score": 0.88,
      "text": "..."
    }
  ]
}
```

```
[INSERT SCREENSHOT 1 HERE]
Caption: The Gantt Replay interface displaying database matched chunks, similarity scores, and filenames when the Retriever node is selected.
```

### 2. The Self-Correcting Pydantic Validation Loop
LLMs are unpredictable, making validation a necessity. I defined a strict schema using Pydantic:

```python
class AgentResponse(BaseModel):
    response_text: str = Field(description="Conversational answer text.")
    is_weather_report: bool
    weather_details: Optional[WeatherDetail] = None
```

I restructured the LangGraph edges to run the `responder` first, followed by the `validator`. If the validator encounters a schema violation, it records a `VALIDATION_FAILURE` event, increments `retries`, and loops back to the responder. 

The responder prompt updates dynamically, instructing Gemini to repair its previous format errors:

```
[ATTENTION: PREVIOUS ATTEMPT FAILED SCHEMA VALIDATION]
Your previous attempt was: {"response_text": ... }
Validation errors reported: Field 'city' is missing.
Please MINIMALLY REPAIR the JSON format to fix the validation issues.
```

```
[INSERT SCREENSHOT 2 HERE]
Caption: Pydantic Validation History console in the trace drawer showing failure details and recovery retry attempts.
```

---

## The Biggest Engineering Lessons I Learned

Building this pipeline led to several architectural realizations:

1. **Deterministic Telemetry vs. LLM Hallucinations**:
   When implementing the *Compare Runs* page (which compares two traces side-by-side), I initially considered letting Gemini analyze the raw runs directly. I quickly changed course. I realized the backend must calculate all differences (latency delta, token difference, cost difference, retry counts) deterministically. Gemini is only used to generate the summary headline and paragraphs, preventing numerical hallucinations.
2. **AI Should Explain Telemetry, Not Generate It**:
   An AI Detective should read structured context summaries—it should never inventory the logs itself. We compile a structured investigation context from event logs, and Gemini reads this database fact sheet to write natural root-cause explanations.
3. **OpenTelemetry standardizes AI observability**:
   Instead of inventing custom JSON structures for tracking LLM token counts and costs, OpenTelemetry's semantic conventions already define parameters like `gen_ai.usage.total_tokens` and `gen_ai.usage.cost`. Standardizing on OTel keeps your system scalable.

---

## Conclusion

Observability is not about tracking metrics after the fact; it's about understanding how your system behaves in real time. By linking LangGraph validation loops, ChromaDB semantic searches, and distributed tracing via OpenTelemetry and SigNoz, we can peer inside the black box of AI agents. 

We can see why an agent failed, watch it correct its own schema formatting, inspect similarity scores, and review OTel trace paths. This makes agent development a structured engineering discipline rather than a series of trial-and-error experiments.
