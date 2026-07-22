import asyncio
import uuid
import json
import logging
from dotenv import load_dotenv
load_dotenv()
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse
from backend.database.db import db
from backend.event.event_broker import event_broker
# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("blackbox.main")

app = FastAPI(title="BlackBox AI API Backend")

# Setup CORS for local TanStack Start frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    await db.connect()
    logger.info("Application startup database connections established.")

@app.on_event("shutdown")
async def shutdown_event():
    await db.disconnect()
    logger.info("Application shutdown database connections closed.")

# API: List all investigations
@app.get("/api/investigations")
async def get_investigations():
    try:
        query = "SELECT * FROM investigations ORDER BY created_at DESC"
        results = await db.fetch_all(query)
        return results
    except Exception as e:
        logger.error(f"Error fetching investigations: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# API: List all events for a trace (Replay timeline consumption)
@app.get("/api/replay/{trace_id}/events")
async def get_trace_events(trace_id: str):
    try:
        query = "SELECT * FROM execution_events WHERE trace_id = $1 ORDER BY timestamp ASC"
        results = await db.fetch_all(query, trace_id)
        return results
    except Exception as e:
        logger.error(f"Error fetching trace events: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Request payload for Playground Chat
from pydantic import BaseModel
class ChatRequest(BaseModel):
    prompt: str
    scenario_id: str = "healthy"
    agent_name: str = "weather-agent"

from backend.service.execution_service import execution_service

# API: Playground Chat with SSE Stream
@app.post("/api/playground/chat")
async def playground_chat(request: ChatRequest):
    prompt = request.prompt
    scenario_id = request.scenario_id
    metadata = {
        "agent_name": request.agent_name
    }
    async def sse_event_generator():
        async for event in execution_service.execute_agent(prompt, scenario_id, metadata):
            yield {
                "event": event["event"],
                "data": json.dumps(event["data"])
            }

    return EventSourceResponse(sse_event_generator())

from backend.service.detective_service import detective_service

# API: Get AI Detective Investigation Report
@app.get("/api/detective/{trace_id}/report")
async def get_detective_report(trace_id: str):
    try:
        report = await detective_service.get_or_generate_report(trace_id)
        return report
    except Exception as e:
        logger.error(f"Error compiling AI Detective report: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# API: Settings diagnostics (Read-only)
@app.get("/api/settings/diagnostics")
async def get_settings_diagnostics():
    import socket
    from urllib.parse import urlparse
    import os

    # Check OTLP reachability
    otlp_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317")
    otlp_reachable = False
    try:
        url_check = otlp_endpoint
        if not url_check.startswith("http://") and not url_check.startswith("https://"):
            url_check = "http://" + url_check
        parsed = urlparse(url_check)
        host = parsed.hostname or "localhost"
        port = parsed.port or 4317
        with socket.create_connection((host, port), timeout=1.0):
            otlp_reachable = True
    except Exception:
        pass

    # Database type detection dynamically
    db_type = "PostgreSQL" if db.is_postgres else "SQLite"

    # Gemini config status
    gemini_key_exists = bool(os.environ.get("GEMINI_API_KEY"))
    gemini_model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
    prompt_version = os.environ.get("DETECTIVE_PROMPT_VERSION", "v1.0")

    return {
        "gemini_model": gemini_model,
        "prompt_version": prompt_version,
        "gemini_api_key_configured": gemini_key_exists,
        "database_type": db_type,
        "opentelemetry_status": "Active (BatchSpanProcessor)",
        "otlp_endpoint": otlp_endpoint,
        "otlp_endpoint_reachable": otlp_reachable
    }


# API: Analytics health summary (Lightweight SQL aggregations)
@app.get("/api/analytics/health")
async def get_analytics_health():
    try:
        total_cases_row = await db.fetch_one("SELECT COUNT(*) as count FROM investigations")
        total_cases = total_cases_row["count"] if total_cases_row else 0
        if total_cases == 0:
            return {
                "total_cases": 0,
                "success_rate": 100.0,
                "avg_latency_ms": 0.0,
                "avg_retries": 0.0,
                "avg_cost": 0.0,
                "error_rate": 0.0,
                "services": []
            }
        
        success_cases_row = await db.fetch_one("SELECT COUNT(*) as count FROM investigations WHERE status = 'completed'")
        success_cases = success_cases_row["count"] if success_cases_row else 0

        avg_latency_row = await db.fetch_one("SELECT AVG(duration_ms) as val FROM investigations")
        avg_latency = avg_latency_row["val"] if avg_latency_row else 0.0

        avg_retries_row = await db.fetch_one("SELECT AVG(retry_count) as val FROM investigations")
        avg_retries = avg_retries_row["val"] if avg_retries_row else 0.0

        avg_cost_row = await db.fetch_one("SELECT AVG(cost) as val FROM investigations")
        avg_cost = avg_cost_row["val"] if avg_cost_row else 0.0

        error_cases_row = await db.fetch_one("SELECT COUNT(*) as count FROM investigations WHERE error_count > 0")
        error_cases = error_cases_row["count"] if error_cases_row else 0

        success_rate = (success_cases / total_cases) * 100
        error_rate = (error_cases / total_cases) * 100

        # Parse node latency metrics from DB execution events dynamically
        events = await db.fetch_all("SELECT payload FROM execution_events WHERE event_type = 'NODE_COMPLETED'")
        
        node_durations = {}
        for row in events:
            try:
                payload = row["payload"]
                if isinstance(payload, str):
                    payload = json.loads(payload)
                node_name = payload.get("node")
                duration = payload.get("duration_ms")
                if node_name and duration is not None:
                    if node_name not in node_durations:
                        node_durations[node_name] = []
                    node_durations[node_name].append(duration)
            except Exception:
                continue

        node_mapping = {
            "llm_router_node": "LLM Router",
            "retriever_node": "Retriever",
            "weather_tool_node": "Weather API Tool",
            "validator_node": "Output Validator",
            "responder_node": "Responder Node",
            "embedding_node": "Embedding Node"
        }

        services = []
        for raw_name, display_name in node_mapping.items():
            if raw_name in node_durations:
                durations = node_durations[raw_name]
                avg_node_latency = sum(durations) / len(durations)
                
                status = "healthy"
                if avg_node_latency > 1200:
                    status = "critical"
                elif avg_node_latency > 500:
                    status = "warn"

                services.append({
                    "name": display_name,
                    "status": status,
                    "uptime": "100.0%" if status == "healthy" else "99.2%" if status == "warn" else "97.5%",
                    "latency": f"{avg_node_latency:.0f}ms"
                })

        return {
            "total_cases": total_cases,
            "success_rate": round(success_rate, 2),
            "avg_latency_ms": round(avg_latency or 0.0, 1),
            "avg_retries": round(avg_retries or 0.0, 2),
            "avg_cost": round(avg_cost or 0.0, 4),
            "error_rate": round(error_rate, 2),
            "services": services
        }
    except Exception as e:
        logger.error(f"Error compiling health metrics: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# API: Compare two runs
@app.get("/api/compare/{trace_id_a}/{trace_id_b}/report")
async def get_compare_report(trace_id_a: str, trace_id_b: str):
    try:
        run_a = await db.fetch_one("SELECT * FROM investigations WHERE id = $1", trace_id_a)
        run_b = await db.fetch_one("SELECT * FROM investigations WHERE id = $1", trace_id_b)
        
        if not run_a or not run_b:
            raise HTTPException(status_code=404, detail="One or both comparison traces not found in database.")
        
        # Convert database row classes to dictionaries
        run_a_dict = dict(run_a)
        run_b_dict = dict(run_b)
        
        report_data = await detective_service.generate_comparison_report(run_a_dict, run_b_dict)
        return report_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error comparing runs: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
