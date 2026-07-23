import asyncio
import uuid
import json
import logging
from typing import Dict, List, Set, Any
from datetime import datetime, timezone
from backend.database.db import db

logger = logging.getLogger("blackbox.event_broker")

class EventBroker:
    def __init__(self):
        # Maps trace_id -> Set of asyncio.Queue to stream events live to SSE clients
        self.subscribers: Dict[str, Set[asyncio.Queue]] = {}

    async def publish(self, trace_id: str, event_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Publishes an execution event:
        1. Persists it to the database.
        2. Broadcasts it to any active SSE subscribers listening to the trace.
        """
        event_id = f"evt_{uuid.uuid4().hex[:12]}"
        timestamp = datetime.now(timezone.utc).isoformat()
        
        event_record = {
            "id": event_id,
            "trace_id": trace_id,
            "event_type": event_type,
            "timestamp": timestamp,
            "payload": payload
        }
        
        # 1. Save to Database
        try:
            query = """
            INSERT INTO execution_events (id, trace_id, event_type, timestamp, payload)
            VALUES ($1, $2, $3, $4, $5)
            """
            await db.execute(query, event_id, trace_id, event_type, timestamp, payload)
        except Exception as e:
            logger.error(f"Error persisting execution event to database: {e}")

        # 2. Broadcast to SSE subscribers
        if trace_id in self.subscribers:
            # We serialize to SSE contract structure
            sse_data = {
                "event": event_type,
                "data": {
                    "traceId": trace_id,
                    "eventId": event_id,
                    "timestamp": timestamp,
                    "payload": payload
                }
            }
            
            # Send message to all queues
            for q in self.subscribers[trace_id]:
                await q.put(sse_data)
                
        return event_record

    def subscribe(self, trace_id: str) -> asyncio.Queue:
        """
        Subscribes a client queue to live execution events for a specific trace.
        """
        q = asyncio.Queue()
        if trace_id not in self.subscribers:
            self.subscribers[trace_id] = set()
        self.subscribers[trace_id].add(q)
        logger.info(f"New client subscribed to trace {trace_id}. Active subscribers: {len(self.subscribers[trace_id])}")
        return q

    def unsubscribe(self, trace_id: str, q: asyncio.Queue):
        """
        Unsubscribes a client queue.
        """
        if trace_id in self.subscribers:
            self.subscribers[trace_id].discard(q)
            if not self.subscribers[trace_id]:
                del self.subscribers[trace_id]
            logger.info(f"Client unsubscribed from trace {trace_id}.")

event_broker = EventBroker()
