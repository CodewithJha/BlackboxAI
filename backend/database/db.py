import os
import sqlite3
import json
import logging
import re
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta, timezone
import asyncpg
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("blackbox.db")

DATABASE_URL = os.getenv("DATABASE_URL", "")

class DatabaseManager:
    def __init__(self):
        self.is_postgres = DATABASE_URL.startswith("postgresql://") or DATABASE_URL.startswith("postgres://")
        self.pg_pool: Optional[asyncpg.Pool] = None
        self.sqlite_conn: Optional[sqlite3.Connection] = None

    async def connect(self):
        if self.is_postgres:
            try:
                logger.info("Connecting to PostgreSQL database...")
                self.pg_pool = await asyncpg.create_pool(DATABASE_URL)
                logger.info("PostgreSQL database connection pool established.")
            except Exception as e:
                logger.warning(f"Failed to connect to PostgreSQL: {e}. Falling back to SQLite.")
                self.is_postgres = False

        if not self.is_postgres:
            logger.info("Initializing SQLite database (fallback/local development)...")
            db_path = os.getenv("SQLITE_PATH", "blackbox.db")
            # Create directories if they don't exist
            db_dir = os.path.dirname(db_path)
            if db_dir:
                os.makedirs(db_dir, exist_ok=True)
            self.sqlite_conn = sqlite3.connect(db_path, check_same_thread=False)
            self.sqlite_conn.row_factory = sqlite3.Row
            logger.info(f"SQLite database initialized at {db_path}")

        # Initialize tables
        await self._init_db()
        # Seed database if empty
        await self._seed_db()

    async def disconnect(self):
        if self.pg_pool:
            await self.pg_pool.close()
            logger.info("Closed PostgreSQL connection pool.")
        if self.sqlite_conn:
            self.sqlite_conn.close()
            logger.info("Closed SQLite connection.")

    async def _init_db(self):
        # We define schema statements that are compatible with both PG and SQLite
        schema_queries = [
            """
            CREATE TABLE IF NOT EXISTS investigations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                agent_name TEXT NOT NULL,
                status TEXT NOT NULL,
                duration_ms INTEGER NOT NULL DEFAULT 0,
                cost REAL NOT NULL DEFAULT 0.0,
                total_tokens INTEGER NOT NULL DEFAULT 0,
                error_count INTEGER NOT NULL DEFAULT 0,
                retry_count INTEGER NOT NULL DEFAULT 0,
                summary TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """,
            """
            CREATE TABLE IF NOT EXISTS execution_events (
                id TEXT PRIMARY KEY,
                trace_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                payload TEXT NOT NULL -- SQLite stores as JSON string, PG as JSONB
            );
            """,
            """
            CREATE TABLE IF NOT EXISTS investigation_reports (
                id TEXT PRIMARY KEY,
                trace_id TEXT NOT NULL,
                executive_summary TEXT NOT NULL,
                root_cause TEXT NOT NULL,
                evidence TEXT NOT NULL, -- JSON string or JSONB
                optimization_opportunities TEXT NOT NULL,
                estimated_savings TEXT NOT NULL,
                recommended_actions TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """
        ]

        if self.is_postgres:
            # PostgreSQL can use the JSONB schema
            # Read schema file and run
            schema_file_path = os.path.join(os.path.dirname(__file__), "schema.sql")
            if os.path.exists(schema_file_path):
                with open(schema_file_path, "r") as f:
                    sql = f.read()
                async with self.pg_pool.acquire() as conn:
                    await conn.execute(sql)
                logger.info("Initialized PostgreSQL schema from schema.sql")
        else:
            # Fallback query runner for SQLite / PG fallback
            for query in schema_queries:
                await self.execute(query)
            logger.info("Database tables verified/created.")

        # Run schema migrations to add prompt_version and investigation_context if needed
        try:
            if self.is_postgres:
                await self.execute("ALTER TABLE investigation_reports ADD COLUMN IF NOT EXISTS prompt_version TEXT DEFAULT 'v1.0'")
                await self.execute("ALTER TABLE investigation_reports ADD COLUMN IF NOT EXISTS investigation_context JSONB")
            else:
                cursor = self.sqlite_conn.cursor()
                cursor.execute("PRAGMA table_info(investigation_reports)")
                columns = [row[1] for row in cursor.fetchall()]
                if "prompt_version" not in columns:
                    cursor.execute("ALTER TABLE investigation_reports ADD COLUMN prompt_version TEXT DEFAULT 'v1.0'")
                    self.sqlite_conn.commit()
                if "investigation_context" not in columns:
                    cursor.execute("ALTER TABLE investigation_reports ADD COLUMN investigation_context TEXT")
                    self.sqlite_conn.commit()
            logger.info("Database migrations successfully checked and applied.")
        except Exception as e:
            logger.warning(f"Could not migrate prompt_version or investigation_context columns: {e}")

    def _normalize_sqlite_query_and_args(self, query: str, args: tuple) -> tuple:
        # Find all placeholders like $1, $2
        placeholders = re.findall(r'\$(\d+)', query)
        if placeholders:
            processed_args = []
            for p in placeholders:
                idx = int(p) - 1
                if idx < len(args):
                    arg = args[idx]
                    if isinstance(arg, (dict, list)):
                        processed_args.append(json.dumps(arg))
                    else:
                        processed_args.append(arg)
                else:
                    processed_args.append(None)
            # Replace all $1, $2... with ?
            q = re.sub(r'\$\d+', '?', query)
            return q, processed_args
        else:
            processed_args = []
            for arg in args:
                if isinstance(arg, (dict, list)):
                    processed_args.append(json.dumps(arg))
                else:
                    processed_args.append(arg)
            return query, processed_args

    async def execute(self, query: str, *args) -> Any:
        if self.is_postgres:
            assert self.pg_pool is not None
            async with self.pg_pool.acquire() as conn:
                return await conn.execute(query, *args)
        else:
            assert self.sqlite_conn is not None
            q, processed_args = self._normalize_sqlite_query_and_args(query, args)
            cursor = self.sqlite_conn.cursor()
            cursor.execute(q, processed_args)
            self.sqlite_conn.commit()
            return cursor.lastrowid

    async def fetch_all(self, query: str, *args) -> List[Dict[str, Any]]:
        if self.is_postgres:
            assert self.pg_pool is not None
            async with self.pg_pool.acquire() as conn:
                records = await conn.fetch(query, *args)
                return [dict(r) for r in records]
        else:
            assert self.sqlite_conn is not None
            q, processed_args = self._normalize_sqlite_query_and_args(query, args)
            cursor = self.sqlite_conn.cursor()
            cursor.execute(q, processed_args)
            rows = cursor.fetchall()
            results = []
            for row in rows:
                item = dict(row)
                # Parse JSON fields if they look like json objects or arrays
                for k, v in item.items():
                    if isinstance(v, str) and (v.startswith("{") or v.startswith("[")):
                        try:
                            item[k] = json.loads(v)
                        except Exception:
                            pass
                results.append(item)
            return results

    async def fetch_one(self, query: str, *args) -> Optional[Dict[str, Any]]:
        rows = await self.fetch_all(query, *args)
        return rows[0] if rows else None

    async def _seed_db(self):
        try:
            # Check if database is already seeded
            existing = await self.fetch_all("SELECT COUNT(*) as count FROM investigations")
            if existing and existing[0]["count"] > 0:
                logger.info("Database already seeded with demo records.")
                return

            logger.info("Seeding database with default hackathon demo records...")

            now = datetime.now(timezone.utc)

            investigations = [
                {
                    "id": "inv_seed1",
                    "title": "What is the weather in Tokyo tomorrow?",
                    "agent_name": "weather-agent",
                    "status": "completed",
                    "duration_ms": 1380,
                    "cost": 0.00074,
                    "total_tokens": 1440,
                    "error_count": 0,
                    "retry_count": 0,
                    "summary": "Tokyo is currently 22°C and clear. Tomorrow trends cool with light wind, and the workflow completed without retries.",
                    "created_at": now - timedelta(minutes=22),
                },
                {
                    "id": "inv_seed2",
                    "title": "Is it raining in London right now?",
                    "agent_name": "weather-agent",
                    "status": "degraded",
                    "duration_ms": 2640,
                    "cost": 0.00079,
                    "total_tokens": 1510,
                    "error_count": 2,
                    "retry_count": 2,
                    "summary": "Execution completed after two upstream rate-limit retries. London is cool with drizzle and moderate wind.",
                    "created_at": now - timedelta(minutes=14),
                },
                {
                    "id": "inv_seed3",
                    "title": "Analyze the temperature in Dubai and return structured JSON.",
                    "agent_name": "weather-agent",
                    "status": "failed",
                    "duration_ms": 1760,
                    "cost": 0.00118,
                    "total_tokens": 2320,
                    "error_count": 1,
                    "retry_count": 2,
                    "summary": "Execution failed after repeated schema validation issues in the structured response output.",
                    "created_at": now - timedelta(minutes=6),
                },
            ]

            for inv in investigations:
                await self.execute(
                    """
                    INSERT INTO investigations (
                        id, title, agent_name, status, duration_ms, cost,
                        total_tokens, error_count, retry_count, summary, created_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    """,
                    inv["id"],
                    inv["title"],
                    inv["agent_name"],
                    inv["status"],
                    inv["duration_ms"],
                    inv["cost"],
                    inv["total_tokens"],
                    inv["error_count"],
                    inv["retry_count"],
                    inv["summary"],
                    inv["created_at"].isoformat(),
                )

            seed_runs = {
                "inv_seed1": {
                    "base_time": now - timedelta(minutes=22),
                    "scenario": "healthy",
                    "report": {
                        "id": "rep_seed1",
                        "executive_summary": "Healthy baseline run completed end-to-end with no retries or validation drift.",
                        "root_cause": "No incident detected. Retrieval, routing, weather lookup, response generation, and schema validation all completed inside baseline timing.",
                        "evidence": [
                            {"event_type": "RETRIEVAL_COMPLETED", "description": "Retriever returned three relevant document chunks in 90ms.", "latency_impact_ms": 90},
                            {"event_type": "NODE_COMPLETED", "description": "Weather Tool completed on the first attempt.", "latency_impact_ms": 240},
                        ],
                        "optimization_opportunities": [
                            {"title": "Keep as baseline", "description": "Use this run as the healthy reference trace during demos.", "est": "Benchmark"},
                        ],
                        "estimated_savings": {"latency": "Optimal", "cost": "Optimal", "win": "Healthy baseline"},
                        "recommended_actions": ["No changes required. Use this run to show the ideal execution path."],
                    },
                    "events": [
                        (0, "NODE_STARTED", {"node_name": "Pipeline", "input": {"prompt": "What is the weather in Tokyo tomorrow?", "scenario_id": "healthy"}}),
                        (20, "NODE_STARTED", {"node_name": "Prompt Parser", "input": {"prompt": "What is the weather in Tokyo tomorrow?", "retries": 0}}),
                        (120, "NODE_COMPLETED", {"node_name": "Prompt Parser", "output": "Cleaned query structure", "metrics": {"cost_delta": 0.0, "token_delta": 42}}),
                        (140, "RETRIEVAL_STARTED", {"node_name": "Retriever (ChromaDB)", "query": "What is the weather in Tokyo tomorrow?"}),
                        (230, "RETRIEVAL_COMPLETED", {"node_name": "Retriever (ChromaDB)", "latency_ms": 90, "model": "models/embedding-001", "document_count": 3, "documents": [
                            {"source_file": "weather_policy.md", "section": "Forecast Access", "score": 0.93},
                            {"source_file": "company_policy.md", "section": "User Safety", "score": 0.78},
                            {"source_file": "welcome.md", "section": "Overview", "score": 0.72},
                        ]}),
                        (250, "NODE_STARTED", {"node_name": "Embedding (text-3-small)", "input": {"prompt": "What is the weather in Tokyo tomorrow?", "retries": 0}}),
                        (360, "NODE_COMPLETED", {"node_name": "Embedding (text-3-small)", "output": "dense_vector_128d", "metrics": {"cost_delta": 0.00003, "token_delta": 128}}),
                        (380, "NODE_STARTED", {"node_name": "LLM Router", "input": {"prompt": "What is the weather in Tokyo tomorrow?", "retries": 0}}),
                        (620, "NODE_COMPLETED", {"node_name": "LLM Router", "output": "route_to_weather", "metrics": {"cost_delta": 0.00009, "token_delta": 610}}),
                        (660, "NODE_STARTED", {"node_name": "Weather Tool (JMA)", "input": {"endpoint": "api.open-meteo.com/v1/forecast"}}),
                        (900, "NODE_COMPLETED", {"node_name": "Weather Tool (JMA)", "output": {"weather": "Real-time weather forecast for Tokyo, Japan: Temperature: 22°C, Wind Speed: 10 km/h."}, "metrics": {"cost_delta": 0.0, "token_delta": 0}}),
                        (940, "NODE_STARTED", {"node_name": "Responder (Stream)", "input": {"prompt": "What is the weather in Tokyo tomorrow?", "retries": 0}}),
                        (1260, "NODE_COMPLETED", {"node_name": "Responder (Stream)", "output": "{\"response_text\": \"Tokyo is currently 22°C and clear. Tomorrow looks mild with light wind.\", \"is_weather_report\": true, \"weather_details\": {\"city\": \"Tokyo\", \"temperature\": 22.0, \"forecast\": \"Clear\", \"wind_speed_kmh\": 10.0}}", "metrics": {"cost_delta": 0.00062, "token_delta": 660}}),
                        (1280, "NODE_STARTED", {"node_name": "Validator (Pydantic)", "input": {"response": "{\"response_text\": \"Tokyo is currently 22°C and clear. Tomorrow looks mild with light wind.\"}"}}),
                        (1360, "NODE_COMPLETED", {"node_name": "Validator (Pydantic)", "output": {"parsed_schema": {"is_weather_report": True}}, "metrics": {"cost_delta": 0.0, "token_delta": 0}}),
                        (1380, "FINISHED", {"status": "completed", "duration_ms": 1380, "cost": 0.00074, "tokens": 1440, "retries": 0, "errors": 0, "response": "{\"response_text\": \"Tokyo is currently 22°C and clear. Tomorrow looks mild with light wind.\", \"is_weather_report\": true, \"weather_details\": {\"city\": \"Tokyo\", \"temperature\": 22.0, \"forecast\": \"Clear\", \"wind_speed_kmh\": 10.0}}"}),
                    ],
                },
                "inv_seed2": {
                    "base_time": now - timedelta(minutes=14),
                    "scenario": "retry_storm",
                    "report": {
                        "id": "rep_seed2",
                        "executive_summary": "Run completed with degraded latency because the weather provider returned rate-limit errors twice before succeeding.",
                        "root_cause": "The weather tool encountered repeated HTTP 429 responses from the upstream provider. The retry path recovered the run, but the added backoff time drove the latency spike.",
                        "evidence": [
                            {"event_type": "RETRY", "description": "Retry attempt 1 followed an upstream 429 response.", "latency_impact_ms": 400},
                            {"event_type": "RETRY", "description": "Retry attempt 2 added another backoff window before success.", "latency_impact_ms": 400},
                        ],
                        "optimization_opportunities": [
                            {"title": "Add short-lived forecast cache", "description": "Cache recent city forecasts to avoid hammering the upstream weather endpoint.", "est": "-1.0s latency"},
                            {"title": "Pre-emptive rate limiting", "description": "Throttle repeated weather calls client-side before the provider issues 429 responses.", "est": "-100% retries"},
                        ],
                        "estimated_savings": {"latency": "-1.0s", "cost": "-0%", "win": "Fewer retries"},
                        "recommended_actions": ["Add a 10-15 minute cache for identical forecast lookups.", "Apply client-side spacing before tool calls hit the upstream weather API."],
                    },
                    "events": [
                        (0, "NODE_STARTED", {"node_name": "Pipeline", "input": {"prompt": "Is it raining in London right now?", "scenario_id": "retry_storm"}}),
                        (30, "NODE_STARTED", {"node_name": "Prompt Parser", "input": {"prompt": "Is it raining in London right now?", "retries": 0}}),
                        (130, "NODE_COMPLETED", {"node_name": "Prompt Parser", "output": "Cleaned query structure", "metrics": {"cost_delta": 0.0, "token_delta": 42}}),
                        (150, "RETRIEVAL_STARTED", {"node_name": "Retriever (ChromaDB)", "query": "Is it raining in London right now?"}),
                        (260, "RETRIEVAL_COMPLETED", {"node_name": "Retriever (ChromaDB)", "latency_ms": 110, "model": "models/embedding-001", "document_count": 2, "documents": [
                            {"source_file": "weather_policy.md", "section": "Forecast Access", "score": 0.91},
                            {"source_file": "welcome.md", "section": "Overview", "score": 0.74},
                        ]}),
                        (290, "NODE_STARTED", {"node_name": "Embedding (text-3-small)", "input": {"prompt": "Is it raining in London right now?", "retries": 0}}),
                        (400, "NODE_COMPLETED", {"node_name": "Embedding (text-3-small)", "output": "dense_vector_128d", "metrics": {"cost_delta": 0.00003, "token_delta": 128}}),
                        (430, "NODE_STARTED", {"node_name": "LLM Router", "input": {"prompt": "Is it raining in London right now?", "retries": 0}}),
                        (700, "NODE_COMPLETED", {"node_name": "LLM Router", "output": "route_to_weather", "metrics": {"cost_delta": 0.00009, "token_delta": 620}}),
                        (760, "NODE_STARTED", {"node_name": "Weather Tool (JMA)", "input": {"endpoint": "api.open-meteo.com/v1/forecast"}}),
                        (1160, "RETRY", {"node_name": "Weather Tool (JMA)", "attempt": 1, "error": "HTTP 429 Too Many Requests (Rate Limited)"}),
                        (1560, "RETRY", {"node_name": "Weather Tool (JMA)", "attempt": 2, "error": "HTTP 429 Too Many Requests (Rate Limited)"}),
                        (2020, "NODE_COMPLETED", {"node_name": "Weather Tool (JMA)", "output": {"weather": "Real-time weather forecast for London, United Kingdom: Temperature: 15°C, Wind Speed: 14 km/h."}, "metrics": {"cost_delta": 0.0, "token_delta": 0}}),
                        (2060, "NODE_STARTED", {"node_name": "Responder (Stream)", "input": {"prompt": "Is it raining in London right now?", "retries": 2}}),
                        (2380, "NODE_COMPLETED", {"node_name": "Responder (Stream)", "output": "{\"response_text\": \"London is cool with light drizzle and moderate wind right now.\", \"is_weather_report\": true, \"weather_details\": {\"city\": \"London\", \"temperature\": 15.0, \"forecast\": \"Drizzle\", \"wind_speed_kmh\": 14.0}}", "metrics": {"cost_delta": 0.00067, "token_delta": 720}}),
                        (2420, "NODE_STARTED", {"node_name": "Validator (Pydantic)", "input": {"response": "{\"response_text\": \"London is cool with light drizzle and moderate wind right now.\"}"}}),
                        (2520, "NODE_COMPLETED", {"node_name": "Validator (Pydantic)", "output": {"parsed_schema": {"is_weather_report": True}}, "metrics": {"cost_delta": 0.0, "token_delta": 0}}),
                        (2640, "FINISHED", {"status": "degraded", "duration_ms": 2640, "cost": 0.00079, "tokens": 1510, "retries": 2, "errors": 2, "response": "{\"response_text\": \"London is cool with light drizzle and moderate wind right now.\", \"is_weather_report\": true, \"weather_details\": {\"city\": \"London\", \"temperature\": 15.0, \"forecast\": \"Drizzle\", \"wind_speed_kmh\": 14.0}}"}),
                    ],
                },
                "inv_seed3": {
                    "base_time": now - timedelta(minutes=6),
                    "scenario": "validation_failure",
                    "report": {
                        "id": "rep_seed3",
                        "executive_summary": "The run failed after the model produced a malformed JSON payload that never passed schema validation.",
                        "root_cause": "The response generator returned a temperature field as text instead of a float. The validation loop retried twice but still exited with a schema failure.",
                        "evidence": [
                            {"event_type": "VALIDATION_FAILURE", "description": "Validator rejected the first structured response because `temperature` was not numeric.", "latency_impact_ms": 80},
                            {"event_type": "VALIDATION_RETRY", "description": "Two repair attempts were triggered before the workflow gave up.", "latency_impact_ms": 320},
                        ],
                        "optimization_opportunities": [
                            {"title": "Tighten response schema prompt", "description": "Add stronger few-shot examples that keep `temperature` numeric.", "est": "-90% format errors"},
                            {"title": "Sanitize tool output before validation", "description": "Cast numeric fields before the final response payload is assembled.", "est": "-100% validator crash"},
                        ],
                        "estimated_savings": {"latency": "-0.4s", "cost": "-18%", "win": "Higher success rate"},
                        "recommended_actions": ["Add a formatting repair stage before the final validator pass.", "Normalize weather tool fields to the Pydantic schema before the response node returns JSON."],
                    },
                    "events": [
                        (0, "NODE_STARTED", {"node_name": "Pipeline", "input": {"prompt": "Analyze the temperature in Dubai and return structured JSON.", "scenario_id": "validation_failure"}}),
                        (25, "NODE_STARTED", {"node_name": "Prompt Parser", "input": {"prompt": "Analyze the temperature in Dubai and return structured JSON.", "retries": 0}}),
                        (120, "NODE_COMPLETED", {"node_name": "Prompt Parser", "output": "Cleaned query structure", "metrics": {"cost_delta": 0.0, "token_delta": 42}}),
                        (150, "RETRIEVAL_STARTED", {"node_name": "Retriever (ChromaDB)", "query": "Analyze the temperature in Dubai and return structured JSON."}),
                        (260, "RETRIEVAL_COMPLETED", {"node_name": "Retriever (ChromaDB)", "latency_ms": 110, "model": "models/embedding-001", "document_count": 2, "documents": [
                            {"source_file": "weather_policy.md", "section": "Forecast Access", "score": 0.89},
                            {"source_file": "company_policy.md", "section": "User Safety", "score": 0.69},
                        ]}),
                        (290, "NODE_STARTED", {"node_name": "Embedding (text-3-small)", "input": {"prompt": "Analyze the temperature in Dubai and return structured JSON.", "retries": 0}}),
                        (400, "NODE_COMPLETED", {"node_name": "Embedding (text-3-small)", "output": "dense_vector_128d", "metrics": {"cost_delta": 0.00003, "token_delta": 128}}),
                        (430, "NODE_STARTED", {"node_name": "LLM Router", "input": {"prompt": "Analyze the temperature in Dubai and return structured JSON.", "retries": 0}}),
                        (700, "NODE_COMPLETED", {"node_name": "LLM Router", "output": "route_to_weather", "metrics": {"cost_delta": 0.00011, "token_delta": 690}}),
                        (740, "NODE_STARTED", {"node_name": "Weather Tool (JMA)", "input": {"endpoint": "api.open-meteo.com/v1/forecast"}}),
                        (980, "NODE_COMPLETED", {"node_name": "Weather Tool (JMA)", "output": {"weather": "Real-time weather forecast for Dubai, United Arab Emirates: Temperature: 39°C, Wind Speed: 9 km/h."}, "metrics": {"cost_delta": 0.0, "token_delta": 0}}),
                        (1020, "NODE_STARTED", {"node_name": "Responder (Stream)", "input": {"prompt": "Analyze the temperature in Dubai and return structured JSON.", "retries": 0}}),
                        (1160, "NODE_COMPLETED", {"node_name": "Responder (Stream)", "output": "{\"response_text\": \"Dubai is hot right now.\", \"is_weather_report\": true, \"weather_details\": {\"city\": \"Dubai\", \"temperature\": \"Very Hot\", \"forecast\": \"Sunny\", \"wind_speed_kmh\": 9.0}}", "metrics": {"cost_delta": 0.00104, "token_delta": 1460}}),
                        (1200, "NODE_STARTED", {"node_name": "Validator (Pydantic)", "input": {"response": "{\"response_text\": \"Dubai is hot right now.\"}"}}),
                        (1280, "VALIDATION_FAILURE", {"node_name": "Validator (Pydantic)", "error_message": "Input should be a valid number for weather_details.temperature", "invalid_response": "{\"response_text\": \"Dubai is hot right now.\", \"is_weather_report\": true, \"weather_details\": {\"city\": \"Dubai\", \"temperature\": \"Very Hot\", \"forecast\": \"Sunny\", \"wind_speed_kmh\": 9.0}}"}),
                        (1320, "VALIDATION_RETRY", {"node_name": "Validator (Pydantic)", "attempt": 1, "error_message": "Input should be a valid number for weather_details.temperature"}),
                        (1400, "VALIDATION_FAILURE", {"node_name": "Validator (Pydantic)", "error_message": "Input should be a valid number for weather_details.temperature", "invalid_response": "{\"response_text\": \"Dubai is hot right now.\", \"is_weather_report\": true, \"weather_details\": {\"city\": \"Dubai\", \"temperature\": \"Very Hot\", \"forecast\": \"Sunny\", \"wind_speed_kmh\": 9.0}}"}),
                        (1440, "VALIDATION_RETRY", {"node_name": "Validator (Pydantic)", "attempt": 2, "error_message": "Input should be a valid number for weather_details.temperature"}),
                        (1520, "ERROR", {"node_name": "Validator (Pydantic)", "error_message": "Validation retries exhausted. temperature must be a number."}),
                        (1760, "FINISHED", {"status": "failed", "duration_ms": 1760, "cost": 0.00118, "tokens": 2320, "retries": 2, "errors": 1, "error": "Validation retries exhausted. temperature must be a number.", "response": "{\"response_text\": \"Dubai is hot right now.\", \"is_weather_report\": true, \"weather_details\": {\"city\": \"Dubai\", \"temperature\": \"Very Hot\", \"forecast\": \"Sunny\", \"wind_speed_kmh\": 9.0}}"}),
                    ],
                },
            }

            event_counter = 1
            for trace_id, run in seed_runs.items():
                base_time = run["base_time"]
                for offset_ms, event_type, payload in run["events"]:
                    timestamp = base_time + timedelta(milliseconds=offset_ms)
                    await self.execute(
                        """
                        INSERT INTO execution_events (id, trace_id, event_type, timestamp, payload)
                        VALUES ($1, $2, $3, $4, $5)
                        """,
                        f"evt_seed_{event_counter}",
                        trace_id,
                        event_type,
                        timestamp.isoformat(),
                        payload,
                    )
                    event_counter += 1

                report = run["report"]
                await self.execute(
                    """
                    INSERT INTO investigation_reports (
                        id, trace_id, executive_summary, root_cause, evidence,
                        optimization_opportunities, estimated_savings, recommended_actions,
                        prompt_version, investigation_context
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    """,
                    report["id"],
                    trace_id,
                    report["executive_summary"],
                    report["root_cause"],
                    report["evidence"],
                    report["optimization_opportunities"],
                    report["estimated_savings"],
                    report["recommended_actions"],
                    "v1.0",
                    {
                        "seeded": True,
                        "scenario": run["scenario"],
                    },
                )
            
            logger.info("Demo seed data injected successfully.")
        except Exception as e:
            logger.error(f"Error seeding database: {e}")

db = DatabaseManager()
