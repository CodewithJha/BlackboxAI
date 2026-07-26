# BlackBox AI

> **From trace to root cause in seconds.**
>
> BlackBox AI turns AI-agent executions from opaque, fragile, impossible-to-debug workflows into something you can **replay, investigate, compare, and explain**.

---

## Why This Exists

AI teams are shipping agents into production faster than they can debug them.

When an agent slows down, retries itself into a spiral, returns malformed output, or quietly burns tokens, most teams still end up doing the same painful routine:

- scan logs
- grep traces
- inspect prompts by hand
- guess where the failure began
- rerun the workflow and hope the bug reproduces

That is the problem BlackBox AI was built to destroy.

This project asks a simple question:

**What if AI systems were as debuggable as software systems?**

Not just observable.
Not just traceable.
Actually **investigable**.

---

## The Big Idea

BlackBox AI is an **observability command center for AI agents**.

It captures a run as an investigation, reconstructs what happened across each execution node, and translates telemetry into a human-understandable answer:

- What failed?
- Where did it fail?
- Why did it fail?
- What should be fixed first?
- What is the likely payoff after the fix?

This is the difference between:

- “here are your logs”

and

- **“here is your root cause.”**

---

## What Makes This Special

Most AI demos stop at one of these:

- a chatbot
- a trace viewer
- a dashboard
- an LLM summary of logs

BlackBox AI combines all of them into a single workflow:

1. **Run an agent**
2. **Capture every important execution event**
3. **Replay the run as a timeline**
4. **Explain the failure through AI Detective**
5. **Compare healthy and degraded runs**
6. **Surface latency, retries, cost, and recovery insight**

This is not “yet another AI UI.”

It is a system for making AI behavior **legible**.

---

## The Winner Story

Imagine a team operating an agent in production:

- A customer asks a question
- The agent calls retrieval
- The router selects a tool
- The tool hits an upstream rate limit
- The responder returns malformed JSON
- Validation fails
- Latency doubles
- Cost spikes

Normally, this becomes a debugging incident.

With BlackBox AI:

- the run is captured as an **Investigation**
- the execution is replayed in **Replay**
- the breakdown is diagnosed in **AI Detective**
- the healthy and degraded runs are contrasted in **Compare Runs**
- the system state is summarized in **AI Health**

Instead of asking engineers to read raw telemetry, the product tells them:

> “This run degraded because the upstream weather provider returned repeated HTTP 429 responses, causing retry overhead and increasing total latency. The highest-leverage fix is adding short-lived caching before tool calls.”

That is the product.
That is the value.
That is the moment this project becomes memorable.

---

## Core Experience

### 1. Investigations
Every AI request becomes a case.

BlackBox AI stores run metadata, agent identity, latency, retries, cost, and summary so you can inspect execution history like incident history, not like random logs.

### 2. Playground
A controlled space to trigger agent runs and watch them stream in real time.

You can intentionally demo:

- healthy execution
- retry storms
- API failure
- cache miss
- expensive prompt inflation
- schema validation failure

### 3. Replay
A frame-by-frame execution timeline that reconstructs the run from stored events.

This makes agent behavior visible as a sequence rather than a wall of text.

### 4. AI Detective
The heart of the project.

AI Detective transforms telemetry into:

- executive summary
- root cause
- cause chain
- blast radius
- next best fix
- projected win after resolution

This is where observability becomes understanding.

### 5. Compare Runs
A judge, engineer, or product team can compare two executions side by side and instantly see:

- which run performed better
- where the regression happened
- how retries, errors, cost, and latency changed

### 6. AI Health
A lightweight operations dashboard for the pipeline itself:

- success rate
- average latency
- average retries
- average cost
- service/node-level health summaries

---

## Why Judges Should Care

This project is built around a real and growing problem:

**AI systems are becoming operational systems.**

As soon as agents touch retrieval, tools, validation, structured outputs, and external APIs, they stop behaving like simple chat apps and start behaving like distributed systems.

Distributed systems need:

- traces
- replay
- diagnosis
- health monitoring
- regression comparison

BlackBox AI applies those principles to agents in a way that is:

- visual
- demoable
- technically grounded
- productizable

This is not a gimmick layer on top of an LLM.

It is an answer to one of the biggest unsolved UX problems in applied AI:

> **How do humans trust, operate, and debug agentic systems?**

---

## Technical Highlights

### Frontend
- TanStack Start
- React
- TypeScript
- rich multi-view operator dashboard
- polished replay / detective / compare surfaces

### Backend
- FastAPI
- LangGraph-style workflow orchestration
- SSE event streaming
- SQLite fallback with PostgreSQL-ready structure
- structured execution event persistence

### Observability
- OpenTelemetry instrumentation
- OTLP export
- SigNoz deployment stack
- trace-aligned event model

### Intelligence Layer
- Gemini-backed route/reasoning/report generation
- offline-safe fallback mode
- deterministic seeded demo cases
- event-to-diagnosis transformation through AI Detective

### Retrieval
- ChromaDB-backed retrieval layer
- embedded local document context
- retrieval telemetry surfaced back into reports

---

## Demo-First Design

Hackathon projects often fail the moment a judge clones them.

BlackBox AI was deliberately shaped to avoid that:

- seeded investigations populate the app on first run
- offline mode still works without a live Gemini key
- startup is one-command friendly
- the core story is visible immediately

That means a judge can experience the product, not just the setup instructions.

---

## The Best Demo Flow

If you only have 2 minutes, show this:

1. Open **Playground**
2. Trigger a degraded or failed run
3. Jump to **Replay** and show where the run slowed or broke
4. Open **AI Detective**
5. Let the product explain:
   - what happened
   - why it happened
   - what to fix first
   - what improvement to expect
6. Compare it with a healthy run in **Compare Runs**

That flow tells the story better than any slide deck.

---

## Local Run

```bash
./run.sh
```

This starts:

- FastAPI backend
- TanStack frontend

If `backend/.env` does not contain a real `GEMINI_API_KEY`, the app runs in **offline demo mode** with seeded investigations and simulated model behavior.

---

## Environment

Example environment file:

```env
GEMINI_API_KEY="your-gemini-key-here"
PORT=8000
HOST="0.0.0.0"
OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4317"
```

Edit:

`backend/.env`

---

## Observability Stack

SigNoz deployment files are included under:

`deploy/signoz/`

To launch the observability stack:

```bash
cd deploy/signoz
docker compose up -d
```

---

## What This Project Believes

AI will not be adopted at scale because it can generate text.

AI will be adopted at scale when teams can:

- understand it
- trust it
- debug it
- improve it
- operate it under failure

BlackBox AI is a step toward that future.

It is built on a belief that should feel obvious in a few years:

> **Every serious AI system deserves serious observability.**

And not just observability.

**Explanation.**

---

## Final Line

BlackBox AI is not trying to be a prettier chatbot.

It is trying to make AI systems **inspectable, explainable, and fixable**.

That is the difference between a demo people watch

and a product people remember.
