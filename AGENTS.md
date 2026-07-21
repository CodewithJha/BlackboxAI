# Project Guidelines & Architecture Notes

This repository contains the full stack implementation for **BlackBox AI**.

## Project Structure
- `backend/`: FastAPI backend with LangGraph workflow, OpenTelemetry exporter, SQLite database, and ChromaDB vectorstore.
- `src/`: TanStack Start / React UI frontend with dark mode design system and real-time trace inspection tools.
- `deploy/signoz/`: Docker Compose deployment stack for SigNoz, OpenTelemetry Collector, and ClickHouse.
