import os
import json
import uuid
import logging
import asyncio
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
import google.generativeai as genai
from backend.database.db import db
from backend.service.scenario_engine import get_scenario
from backend.config import has_configured_gemini_api_key

logger = logging.getLogger("blackbox.detective_service")

# Load environment configuration
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
DETECTIVE_PROMPT_VERSION = os.getenv("DETECTIVE_PROMPT_VERSION", "v1.0")

# Configure Gemini model client
gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
gemini_model = None
if has_configured_gemini_api_key():
    try:
        genai.configure(api_key=gemini_key)
        gemini_model = genai.GenerativeModel(GEMINI_MODEL)
        logger.info(f"Google Gemini SDK client configured for DetectiveService using model: {GEMINI_MODEL}")
    except Exception as e:
        logger.error(f"Error configuring Gemini SDK client in DetectiveService: {e}")

class DetectiveService:
    async def get_or_generate_report(self, trace_id: str) -> Dict[str, Any]:
        """
        Retrieves a cached Investigation Report for a trace matching both trace_id
        and prompt_version, or generates a new one using Gemini if available.
        """
        # 1. Try to fetch from DB matching both trace_id and prompt_version
        query = "SELECT * FROM investigation_reports WHERE trace_id = $1 AND prompt_version = $2"
        cached = await db.fetch_one(query, trace_id, DETECTIVE_PROMPT_VERSION)
        if cached:
            logger.info(f"Loaded cached Investigation Report for trace {trace_id} (version {DETECTIVE_PROMPT_VERSION})")
            return cached

        # 2. Compile execution context from events
        events_query = "SELECT * FROM execution_events WHERE trace_id = $1 ORDER BY timestamp ASC"
        events = await db.fetch_all(events_query, trace_id)
        
        # 3. Generate structured report based on events
        report_data = await self.build_report(trace_id, events)
        
        # 4. Cache in DB
        report_id = f"rep_{uuid.uuid4().hex[:12]}"
        insert_query = """
        INSERT INTO investigation_reports (
            id, trace_id, executive_summary, root_cause, evidence, 
            optimization_opportunities, estimated_savings, recommended_actions, 
            prompt_version, investigation_context
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        """
        try:
            # db.execute automatically handles serializing dict/list to string for SQLite
            await db.execute(
                insert_query,
                report_id,
                trace_id,
                report_data["executive_summary"],
                report_data["root_cause"],
                report_data["evidence"],
                report_data["optimization_opportunities"],
                report_data["estimated_savings"],
                report_data["recommended_actions"],
                DETECTIVE_PROMPT_VERSION,
                report_data.get("investigation_context")
            )
            logger.info(f"Cached new Investigation Report: {report_id} for trace {trace_id}")
        except Exception as e:
            logger.error(f"Failed to cache Investigation Report: {e}")
            
        report_data["id"] = report_id
        report_data["trace_id"] = trace_id
        return report_data

    async def build_report(self, trace_id: str, events: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Assembles a structured context from execution events and builds the report
        using live Gemini LLM reasoning, with a rule-based fallback.
        """
        if not events:
            empty_report = self.get_empty_report()
            empty_report["investigation_context"] = {}
            return empty_report

        # 1. Build deterministic metrics in the backend
        finished_event = next((e for e in events if e["event_type"] == "FINISHED"), None)
        finished_payload = {}
        if finished_event:
            p = finished_event["payload"]
            finished_payload = json.loads(p) if isinstance(p, str) else p

        status = finished_payload.get("status", "completed")
        duration_ms = finished_payload.get("duration_ms", 500)
        cost = finished_payload.get("cost", 0.003)
        tokens = finished_payload.get("tokens", 1000)
        retries = finished_payload.get("retries", 0)
        errors = finished_payload.get("errors", 0)

        # Detect active scenario details
        is_retry_storm = retries >= 3
        is_api_failure = status == "failed" and errors >= 2
        is_validation_failure = status == "failed" and any(
            e["event_type"] == "ERROR" and "Validator" in str(e["payload"]) for e in events
        )
        
        # Check for cache miss
        retriever_comp = next((e for e in events if e["event_type"] == "NODE_COMPLETED" and "Retriever" in str(e["payload"])), None)
        is_cache_miss = False
        if retriever_comp:
            p = retriever_comp["payload"]
            p_dict = json.loads(p) if isinstance(p, str) else p
            output = p_dict.get("output", {})
            if isinstance(output, dict):
                is_cache_miss = not output.get("cache_hit", True)

        is_expensive = tokens > 5000
        is_high_latency = duration_ms > 2000 and not is_retry_storm and not is_cache_miss and not is_expensive

        inferred_scenario = "healthy"
        if is_api_failure:
            inferred_scenario = "api_failure"
        elif is_retry_storm:
            inferred_scenario = "retry_storm"
        elif is_validation_failure:
            inferred_scenario = "validation_failure"
        elif is_cache_miss:
            inferred_scenario = "cache_miss"
        elif is_expensive:
            inferred_scenario = "expensive_prompt"
        elif is_high_latency:
            inferred_scenario = "high_latency"

        # 2. Build Structured Investigation Context
        events_summary = []
        anomalies_detected = []
        retrieval_details = []
        
        for e in events:
            evt_type = e["event_type"]
            p = e["payload"]
            payload_dict = json.loads(p) if isinstance(p, str) else p
            
            clean_payload = {}
            if isinstance(payload_dict, dict):
                for k in ["node_name", "status", "retries", "error", "metrics", "output"]:
                    if k in payload_dict:
                        clean_payload[k] = payload_dict[k]
            else:
                clean_payload = payload_dict
                
            events_summary.append({
                "event_type": evt_type,
                "timestamp": str(e.get("timestamp")),
                "payload": clean_payload
            })

            # Track anomalies
            if evt_type == "ERROR":
                anomalies_detected.append(f"Error in node {clean_payload.get('node_name')}: {clean_payload.get('error') or clean_payload}")
            elif evt_type == "RETRY":
                anomalies_detected.append(f"Retry attempt in node {clean_payload.get('node_name')}")
            elif evt_type == "VALIDATION_FAILURE":
                anomalies_detected.append(f"Pydantic validation failure: {payload_dict.get('error_message')}")
            elif evt_type == "RETRIEVAL_COMPLETED":
                retrieval_details.append({
                    "latency_ms": payload_dict.get("latency_ms"),
                    "model": payload_dict.get("model"),
                    "document_count": payload_dict.get("document_count"),
                    "documents": payload_dict.get("documents")
                })

        investigation_context = {
            "trace_id": trace_id,
            "status": status,
            "duration_ms": duration_ms,
            "cost": cost,
            "tokens": tokens,
            "retries_count": retries,
            "errors_count": errors,
            "inferred_scenario": inferred_scenario,
            "events_summary": events_summary,
            "anomalies_detected": anomalies_detected,
            "retrieval_details": retrieval_details
        }

        # 3. Call Gemini if available, otherwise fall back to rule-based template
        if gemini_model:
            try:
                prompt_text = f"""You are an AI Observability Engineer.
Analyze the following Structured Investigation Context of an AI agent execution trace and generate a narrative explanation report in JSON format.

=== Structured Investigation Context ===
{json.dumps(investigation_context, indent=2)}
========================================

Constraints:
1. Analyze ONLY the supplied telemetry.
2. Never invent metrics, timings, costs, retries, or events.
3. Never estimate values that are not provided.
4. Base every conclusion strictly on the supplied execution evidence.
5. If the evidence is insufficient, explicitly say so.
6. Return EXACTLY a JSON object matching this schema (do not wrap in markdown or block backticks, do not prefix with ```json):
{{
  "executive_summary": "Clean, high-level summary of the execution run status and performance.",
  "root_cause": "Detailed technical root cause explaining why any delays, retries, or errors occurred based strictly on the events.",
  "evidence": [
    {{
      "event_type": "The event type (e.g. RETRY, ERROR, NODE_COMPLETED)",
      "description": "Evidence description",
      "latency_impact_ms": 123
    }}
  ],
  "optimization_opportunities": [
    {{
      "title": "Opportunity title",
      "description": "How to resolve this issue in the future",
      "est": "Short metric of estimated savings, e.g. -1.2s latency or -100% crash rate (max 3-4 words)"
    }}
  ],
  "estimated_savings": {{
    "latency": "Estimated latency reduction, e.g. -1.2s",
    "cost": "Estimated cost reduction, e.g. -15%",
    "win": "High-level summary of the win, e.g. -100% crash rate"
  }},
  "recommended_actions": [
    "Specific recommended action 1",
    "Specific recommended action 2"
  ]
}}
"""
                logger.info(f"Requesting Gemini AI Detective analysis for trace {trace_id}...")
                
                # Execute Gemini block using asyncio-compatible thread executor
                loop = asyncio.get_event_loop()
                response = await loop.run_in_executor(
                    None,
                    lambda: gemini_model.generate_content(prompt_text)
                )
                
                response_text = response.text.strip()
                
                # Strip markdown code blocks if the LLM returned them anyway
                if response_text.startswith("```"):
                    lines = response_text.split("\n")
                    if lines[0].startswith("```"):
                        lines = lines[1:]
                    if lines[-1].strip() == "```":
                        lines = lines[:-1]
                    response_text = "\n".join(lines).strip()
                
                gemini_report = json.loads(response_text)
                
                # Validate required narrative keys
                required_keys = ["executive_summary", "root_cause", "evidence", "optimization_opportunities", "estimated_savings", "recommended_actions"]
                if all(key in gemini_report for key in required_keys):
                    logger.info("Successfully compiled narrative explanation report via Gemini model.")
                    # Build and return the merged report
                    return {
                        "executive_summary": gemini_report["executive_summary"],
                        "root_cause": gemini_report["root_cause"],
                        "evidence": gemini_report["evidence"],
                        "optimization_opportunities": gemini_report["optimization_opportunities"],
                        "estimated_savings": gemini_report["estimated_savings"],
                        "recommended_actions": gemini_report["recommended_actions"],
                        "prompt_version": DETECTIVE_PROMPT_VERSION,
                        "investigation_context": investigation_context
                    }
                else:
                    logger.warning("Gemini report output was missing required JSON keys, falling back to rule-based report.")
            except Exception as e:
                logger.error(f"Error compiling AI Detective report using Gemini: {e}")
                
        # 4. Fallback to rule-based builder if Gemini fails or is not available
        logger.info(f"Building fallback rule-based investigation report for trace {trace_id}...")
        fallback_data = self.build_fallback_report(inferred_scenario)
        fallback_data["prompt_version"] = DETECTIVE_PROMPT_VERSION
        fallback_data["investigation_context"] = investigation_context
        return fallback_data

    def build_fallback_report(self, inferred_scenario: str) -> Dict[str, Any]:
        """
        Original rule-based builder fallback templates.
        """
        if inferred_scenario == "api_failure":
            return {
                "executive_summary": "Execution aborted after 1.9 seconds due to permanent tool dependency failure.",
                "root_cause": "The Weather Tool (JMA) failed repeatedly returning HTTP 500 Internal Server Error. Fallback path was not configured, aborting execution.",
                "evidence": [
                    {"event_type": "ERROR", "description": "Weather Tool (JMA) failed (HTTP 500)", "latency_impact_ms": 400},
                    {"event_type": "ERROR", "description": "Aborted graph path: validation bypassed", "latency_impact_ms": 0}
                ],
                "optimization_opportunities": [
                    {"title": "Graceful Fallback Response", "description": "Provide a cached or friendly static error string when JMA Weather API returns a server failure.", "est": "-100% crash rate"},
                    {"title": "Backup API Provider", "description": "Configure secondary backup endpoint (e.g. OpenWeatherMap) to failover on HTTP 5xx.", "est": "-95% failure rate"}
                ],
                "estimated_savings": {
                    "latency": "−1.2s",
                    "cost": "−15%",
                    "win": "−100% crash rate"
                },
                "recommended_actions": [
                    "Configure a fallback node in LangGraph to handle tool errors.",
                    "Implement a client retry policy with secondary server endpoints."
                ]
            }

        elif inferred_scenario == "retry_storm":
            return {
                "executive_summary": "Execution completed with degraded performance (+1.4s delay) due to tool rate limiting.",
                "root_cause": "The Weather Tool (JMA) encountered HTTP 429 (Too Many Requests) three times. Exponential backoff loops added 1400ms overhead.",
                "evidence": [
                    {"event_type": "RETRY", "description": "Attempt 1: rate limited on JMA weather forecast API", "latency_impact_ms": 400},
                    {"event_type": "RETRY", "description": "Attempt 2: rate limited (backoff wait applied)", "latency_impact_ms": 400},
                    {"event_type": "RETRY", "description": "Attempt 3: rate limited (backoff wait applied)", "latency_impact_ms": 400}
                ],
                "optimization_opportunities": [
                    {"title": "Client Rate Limiting", "description": "Implement a local token bucket rate limiter to space requests and prevent HTTP 429.", "est": "−1.2s latency"},
                    {"title": "Enable caching on Weather API", "description": "Cache weather forecasts with a 15-minute TTL to reduce upstream fetch counts.", "est": "−100% API calls"}
                ],
                "estimated_savings": {
                    "latency": "−1.2s",
                    "cost": "−0%",
                    "win": "−1.2s latency"
                },
                "recommended_actions": [
                    "Introduce standard Redis caching on the JMA Weather Tool adapter.",
                    "Setup client-side queue spacing to respect upstream rate thresholds."
                ]
            }

        elif inferred_scenario == "validation_failure":
            return {
                "executive_summary": "Execution aborted due to output validator schema constraints mismatch.",
                "root_cause": "The LLM response structure violated JSON schema specifications. The Validator (zod) node raised a format ValidationError, stopping responder output.",
                "evidence": [
                    {"event_type": "ERROR", "description": "Validator (zod) raised format ValidationError", "latency_impact_ms": 50}
                ],
                "optimization_opportunities": [
                    {"title": "Enhanced Prompt Schema Guidance", "description": "Specify exact JSON structures and append few-shot formatting examples to the system prompt.", "est": "-90% format errors"},
                    {"title": "Self-Correction Loop", "description": "Inject format errors back into the LLM context to correct output formatting in a dynamic retry edge.", "est": "-100% crash rate"}
                ],
                "estimated_savings": {
                    "latency": "−0.1s",
                    "cost": "−20%",
                    "win": "−100% crash rate"
                },
                "recommended_actions": [
                    "Update prompt schemas to include strict few-shot examples.",
                    "Implement a LangGraph routing loop: Validator -> Format Fixer LLM -> Validator."
                ]
            }

        elif inferred_scenario == "cache_miss":
            return {
                "executive_summary": "Succeeded but was delayed by a cold vector DB retrieval.",
                "root_cause": "The Retriever (pgvector) encountered a cold index cache miss, forcing pgvector to perform full index scans.",
                "evidence": [
                    {"event_type": "NODE_COMPLETED", "description": "Retriever (pgvector) cold start cache miss", "latency_impact_ms": 1000}
                ],
                "optimization_opportunities": [
                    {"title": "Enable Semantic Cache", "description": "Implement a semantic cache layer (e.g. RedisVL) with a 5-minute TTL on retriever queries.", "est": "−1.0s latency"},
                    {"title": "Warm-up embeddings cache", "description": "Preload top 100 index keys during server boot or cold restarts.", "est": "−95% latency spike"}
                ],
                "estimated_savings": {
                    "latency": "−1.0s",
                    "cost": "−0%",
                    "win": "−1.0s latency"
                },
                "recommended_actions": [
                    "Add Semantic Cache middleware to vector retrievers.",
                    "Configure index warming cron jobs for production databases."
                ]
            }

        elif inferred_scenario == "expensive_prompt":
            return {
                "executive_summary": "Run completed successfully, but LLM costs spiked by 5x baseline.",
                "root_cause": "The Retriever returned too much search context (top-k=12), generating an inflated context window of 7420 tokens.",
                "evidence": [
                    {"event_type": "NODE_COMPLETED", "description": "LLM Router token consumption at 7420 tokens", "latency_impact_ms": 0}
                ],
                "optimization_opportunities": [
                    {"title": "Reduce Retriever top-k", "description": "Drop search retrieval counts from top-12 down to top-6. Evaluates show no loss of context precision.", "est": "−48% tokens cost"},
                    {"title": "Context Compression", "description": "Implement LLMLingua compression on raw retrieval chunks to drop noise tokens before LLM input.", "est": "−30% costs"}
                ],
                "estimated_savings": {
                    "latency": "−300ms",
                    "cost": "−48%",
                    "win": "−48% cost"
                },
                "recommended_actions": [
                    "Change prompt builder to use top-k=6.",
                    "Add context compression layers to drop redundant words before routing."
                ]
            }

        elif inferred_scenario == "high_latency":
            return {
                "executive_summary": "Execution succeeded but was delayed by network latency anomalies.",
                "root_cause": "Amplified latencies across multiple network boundaries (embedding API, retriever read, LLM token streaming).",
                "evidence": [
                    {"event_type": "NODE_COMPLETED", "description": "Retriever delayed reading indexes", "latency_impact_ms": 1500},
                    {"event_type": "NODE_COMPLETED", "description": "Weather Tool sequence network latency", "latency_impact_ms": 2500}
                ],
                "optimization_opportunities": [
                    {"title": "Concurrently execute tools", "description": "Run the weather tool API and embedding generator concurrently instead of sequentially.", "est": "−800ms latency"},
                    {"title": "API Gateway Route optimization", "description": "Place API servers in direct physical proximity (same AWS region) to vector engines.", "est": "−300ms latency"}
                ],
                "estimated_savings": {
                    "latency": "−1.1s",
                    "cost": "−0%",
                    "win": "−1.1s latency"
                },
                "recommended_actions": [
                    "Parallelize independent tool calls using asyncio.gather.",
                    "Optimize routing structures across AWS regions."
                ]
            }

        else:
            # Healthy
            return {
                "executive_summary": "Execution completed successfully in optimal time. Every node resolved within baseline parameters.",
                "root_cause": "Optimal cache hits, sequential node efficiency, and zero error retries.",
                "evidence": [
                    {"event_type": "NODE_COMPLETED", "description": "Retriever cache hit successfully resolved", "latency_impact_ms": 0}
                ],
                "optimization_opportunities": [
                    {"title": "Further compression", "description": "Current performance is fully optimized. Keep monitoring baseline variance.", "est": "Optimal"}
                ],
                "estimated_savings": {
                    "latency": "Optimal",
                    "cost": "Optimal",
                    "win": "Optimal"
                },
                "recommended_actions": [
                    "Baseline verified. No further optimizations are required."
                ]
            }

    async def generate_comparison_report(self, run_a: Dict[str, Any], run_b: Dict[str, Any]) -> Dict[str, Any]:
        """
        Computes a deterministic comparison summary (winner, score delta, primary reason)
        before passing the structured comparison to Gemini for a narrative explanation.
        """
        # Parse metrics
        latency_a = run_a.get("duration_ms", 0)
        latency_b = run_b.get("duration_ms", 0)
        tokens_a = run_a.get("total_tokens", 0)
        tokens_b = run_b.get("total_tokens", 0)
        cost_a = run_a.get("cost", 0.0)
        cost_b = run_b.get("cost", 0.0)
        retries_a = run_a.get("retry_count", 0)
        retries_b = run_b.get("retry_count", 0)
        errors_a = run_a.get("error_count", 0)
        errors_b = run_b.get("error_count", 0)

        # Compute deterministic score: higher score is better (base 100)
        # Latency penalty: -1 point per 100ms
        # Retry penalty: -15 points per retry
        # Error penalty: -35 points per error
        score_a = max(0, 100 - int(latency_a / 100) - (retries_a * 15) - (errors_a * 35))
        score_b = max(0, 100 - int(latency_b / 100) - (retries_b * 15) - (errors_b * 35))
        score_delta = score_b - score_a

        # Determine winner
        if score_delta > 0:
            winner = "Run B"
        elif score_delta < 0:
            winner = "Run A"
        else:
            winner = "Tie"

        # Determine primary reason deterministically
        if errors_b > errors_a:
            primary_reason = f"Run B encountered {errors_b - errors_a} additional errors during execution."
        elif errors_a > errors_b:
            primary_reason = f"Run A was degraded by {errors_a - errors_b} errors which were resolved in Run B."
        elif retries_b > retries_a:
            primary_reason = f"Run B was delayed by {retries_b - retries_a} API rate limit retries."
        elif retries_a > retries_b:
            primary_reason = f"Run A suffered from {retries_a - retries_b} API retries which were avoided in Run B."
        elif latency_b > latency_a + 500:
            primary_reason = f"Run B took {int(latency_b - latency_a)}ms longer to execute, indicating layout/traversal delays."
        elif latency_a > latency_b + 500:
            primary_reason = f"Run B was {int(latency_a - latency_b)}ms faster due to optimized node sequence."
        elif cost_b > cost_a * 1.5:
            primary_reason = f"Run B consumed significantly more tokens, increasing cost by {int((cost_b - cost_a)/max(cost_a, 0.001)*100)}%."
        else:
            primary_reason = "Both runs performed within baseline variance."

        comparison_data = {
            "run_a": {
                "id": run_a.get("id"),
                "title": run_a.get("title"),
                "latency_ms": latency_a,
                "tokens": tokens_a,
                "cost": cost_a,
                "retries": retries_a,
                "errors": errors_a,
                "status": run_a.get("status")
            },
            "run_b": {
                "id": run_b.get("id"),
                "title": run_b.get("title"),
                "latency_ms": latency_b,
                "tokens": tokens_b,
                "cost": cost_b,
                "retries": retries_b,
                "errors": errors_b,
                "status": run_b.get("status")
            },
            "metrics_diff": {
                "latency_diff_ms": latency_b - latency_a,
                "tokens_diff": tokens_b - tokens_a,
                "cost_diff": cost_b - cost_a,
                "retries_diff": retries_b - retries_a,
                "errors_diff": errors_b - errors_a,
                "winner": winner,
                "score_delta": score_delta,
                "primary_reason": primary_reason
            }
        }

        # Query Gemini for the narrative explanation based STRICTLY on the comparison data
        headline = f"{winner} performed better" if winner != "Tie" else "Both runs performed similarly"
        explanation = f"Comparative metrics show that {primary_reason}"

        if gemini_model:
            prompt = f"""
            You are an AI Observability Engineer analyzing a performance comparison between two execution runs.
            You must write a narrative explanation describing the performance changes between Run A and Run B.

            Here is the structured comparison data computed deterministically:
            {json.dumps(comparison_data, indent=2)}

            Instructions:
            1. Write a headline summarizing the performance difference (max 15 words).
            2. Write a detailed paragraph (explanation) explaining what caused the variance.
            3. Do NOT invent, guess, or calculate any metrics or numbers. Base your story strictly on the calculated numbers provided.
            4. If Run B has more retries or latency, highlight that as a rate limit/bottleneck. If it has lower latency, highlight it as an optimization.
            5. Return EXACTLY a JSON object with this schema (no backticks, no markdown):
            {{
              "headline": "A short, technical headline summarizing the difference",
              "explanation": "A detailed paragraph explaining why the difference occurred, referencing the primary reason."
            }}
            """
            try:
                loop = asyncio.get_event_loop()
                response = await loop.run_in_executor(
                    None,
                    lambda: gemini_model.generate_content(
                        prompt,
                        generation_config={"response_mime_type": "application/json"}
                    )
                )
                res_text = response.text.strip()
                if res_text.startswith("```"):
                    lines = res_text.splitlines()
                    if lines[0].startswith("```json"):
                        res_text = "\n".join(lines[1:-1])
                    elif lines[0].startswith("```"):
                        res_text = "\n".join(lines[1:-1])
                
                parsed = json.loads(res_text.strip())
                headline = parsed.get("headline", headline)
                explanation = parsed.get("explanation", explanation)
            except Exception as e:
                logger.error(f"Error querying Gemini for run comparison narrative: {e}. Falling back to template.")

        comparison_data["narrative"] = {
            "headline": headline,
            "explanation": explanation
        }
        return comparison_data

    def get_empty_report(self) -> Dict[str, Any]:
        return {
            "executive_summary": "No telemetry data found for this trace ID.",
            "root_cause": "Trace history is empty or purge schedule cleaned active events.",
            "evidence": [],
            "optimization_opportunities": [],
            "estimated_savings": {"latency": "0ms", "cost": "0%", "win": "None"},
            "recommended_actions": []
        }

detective_service = DetectiveService()
