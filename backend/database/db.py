import os
import sqlite3
import json
import logging
import re
from typing import List, Dict, Any, Optional
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

db = DatabaseManager()
