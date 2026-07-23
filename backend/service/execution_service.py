import asyncio
import uuid
import logging
from typing import Dict, Any, AsyncGenerator
from backend.database.db import db
from backend.event.event_broker import event_broker
from backend.agent.agent_workflow import run_agent_workflow
from backend.service.scenario_engine import get_scenario

logger = logging.getLogger("blackbox.execution_service")

class ExecutionService:
    async def create_investigation(self, trace_id: str, prompt: str, agent_name: str) -> None:
        """
        Creates the initial investigation record in the database.
        """
        query = """
        INSERT INTO investigations (id, title, agent_name, status, duration_ms, cost, total_tokens, error_count, retry_count, summary)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        """
        await db.execute(
            query,
            trace_id,
            prompt,
            agent_name,
            "running",
            0, 0.0, 0, 0, 0,
            "Execution in progress..."
        )
        logger.info(f"Database record created for investigation: {trace_id}")

    async def update_investigation_results(self, trace_id: str, payload: Dict[str, Any]) -> None:
        """
        Updates the final database metrics for an investigation once finished.
        """
        status = payload.get("status", "completed")
        duration_ms = payload.get("duration_ms", 0)
        cost = payload.get("cost", 0.0)
        tokens = payload.get("tokens", 0)
        retries = payload.get("retries", 0)
        errors = payload.get("errors", 0)
        response = payload.get("response", "")

        # Compute diagnostic summary description
        sc_id = payload.get("scenario_id", "healthy")
        summary = response
        if status == "failed":
            summary = f"Execution failed: {payload.get('error', 'Critical validation or tool failure')}"
        elif retries > 0:
            summary = f"Execution complete with {retries} retry attempts during tool operation."

        query = """
        UPDATE investigations 
        SET status = $2, duration_ms = $3, cost = $4, total_tokens = $5, 
            retry_count = $6, error_count = $7, summary = $8
        WHERE id = $1
        """
        await db.execute(query, trace_id, status, duration_ms, cost, tokens, retries, errors, summary)
        logger.info(f"Database record updated for investigation: {trace_id} ({status})")

    async def execute_agent(
        self, 
        prompt: str, 
        scenario_id: str, 
        metadata: Dict[str, Any]
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Single entry point for agent execution. Launches the LangGraph workflow and 
        yields structured execution events to stream back via SSE.
        """
        trace_id = f"inv_{uuid.uuid4().hex[:6]}"
        agent_name = metadata.get("agent_name", "weather-agent")

        # 1. Persist initial investigation row
        await self.create_investigation(trace_id, prompt, agent_name)

        # 2. Subscribe to the Event Broker for this trace
        event_queue = event_broker.subscribe(trace_id)

        # 3. Launch LangGraph agent workflow in the background
        agent_task = asyncio.create_task(
            run_agent_workflow(trace_id, prompt, scenario_id)
        )

        try:
            while True:
                # Retrieve event emitted from the graph node/telemetry hooks
                event_data = await event_queue.get()
                yield event_data

                # Check if execution finished
                if event_data["event"] == "FINISHED":
                    payload = event_data["data"]["payload"]
                    payload["scenario_id"] = scenario_id
                    
                    # 4. Persist final telemetry statistics
                    await self.update_investigation_results(trace_id, payload)
                    break
        except asyncio.CancelledError:
            logger.info(f"Execution context cancelled for trace {trace_id}.")
            raise
        except Exception as e:
            logger.error(f"Error during execution event stream: {e}")
            raise
        finally:
            # Cleanup subscriptions and running tasks
            event_broker.unsubscribe(trace_id, event_queue)
            if not agent_task.done():
                agent_task.cancel()

execution_service = ExecutionService()
