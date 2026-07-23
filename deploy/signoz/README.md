# SigNoz Observability Stack Deployment

This directory contains the self-contained SigNoz and OpenTelemetry Collector stack to trace the **BlackBox AI** agent execution.

---

## 🚀 Startup Instructions

To start the observability containers, run:

```bash
# Navigate to the signoz deployment directory
cd deploy/signoz

# Launch the containers in detached mode
docker compose up -d
```

Verify that all containers are healthy:

```bash
docker compose ps
```

---

## 📈 Verification & Expected Behavior

1. **SigNoz UI Console**: Open [http://localhost:3301](http://localhost:3301) in your browser.
2. **First Run Ingestion**: 
   * Trigger a chat execution in the **Playground** at [http://localhost:8080/app/playground](http://localhost:8080/app/playground).
   * Open the SigNoz Services dashboard. You will see the **`blackbox-ai`** service pop up.
   * Click on the service to explore waterfall Gantt charts for the agent workflow execution nodes (e.g. `llm_router`, `weather_tool`, `responder`, `validator`).

---

## 🛠️ Troubleshooting

### 1. Port conflicts
If port `3301` or `4317` is already bound on your system:
* Check which process is running on the port:
  ```bash
  lsof -i :4317
  lsof -i :3301
  ```
* Terminate the conflicting process or change the port bindings inside the `ports` mapping of `docker-compose.yml`.

### 2. OTel Endpoint Connection Refused
If the backend uvicorn terminal prints connection warnings:
* Ensure that the `otel-collector` container has successfully completed its startup.
* Verify the collector is listening:
  ```bash
  nc -zv localhost 4317
  ```
* Read the collector container logs:
  ```bash
  docker logs signoz-otel-collector
  ```
