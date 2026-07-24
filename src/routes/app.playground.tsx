import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell, PageAction } from "@/components/AppShell";
import { PipelineFlow, defaultPipeline } from "@/components/PipelineFlow";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Paperclip, Sparkles, User, X, Clock, Coins, AlertTriangle, RotateCw, Zap, ChevronRight, ArrowRight, Waypoints } from "lucide-react";

export const Route = createFileRoute("/app/playground")({
  component: Playground,
});

type Msg = { role: "user" | "assistant"; text: string };

const initial: Msg[] = [
  { role: "user", text: "What's the weather in Tokyo, and should I bring an umbrella tomorrow?" },
  { role: "assistant", text: "Tokyo is currently 22°C and clear. Tomorrow's forecast shows a 68% chance of afternoon rain — I'd bring a compact umbrella. I checked JMA data via the weather tool and cross-referenced NOAA satellite imagery for consistency." },
];

const pipeline = [
  { label: "Prompt", meta: "input" },
  { label: "Retriever", meta: "top-k=6" },
  { label: "Embedding", meta: "text-3-small" },
  { label: "LLM", meta: "Gemini 2.5" },
  { label: "Weather Tool", meta: "JMA" },
  { label: "Validator", meta: "Pydantic" },
  { label: "Response", meta: "stream" },
];

const nodeIndexMap: Record<string, number> = {
  "Prompt Parser": 0,
  "Retriever (ChromaDB)": 1,
  "Embedding (text-3-small)": 2,
  "LLM Router": 3,
  "Weather Tool (JMA)": 4,
  "Validator (Pydantic)": 5,
  "Responder (Stream)": 6
};

function renderFormattedText(text: string) {
  if (!text) return null;

  // Split text by lines to handle bullet points and paragraphs
  const lines = text.split("\n");
  
  return lines.map((line, idx) => {
    let cleanLine = line.trim();
    if (!cleanLine) return <div key={idx} className="h-2" />;
    
    // Check if line is a bullet point (starts with "* " or "- ")
    const isBullet = cleanLine.startsWith("* ") || cleanLine.startsWith("- ");
    if (isBullet) {
      cleanLine = cleanLine.substring(2);
    }

    // Replace **text** with <strong>text</strong>
    const parts = [];
    const regex = /\*\*(.*?)\*\*/g;
    let match;
    let lastIndex = 0;

    while ((match = regex.exec(cleanLine)) !== null) {
      const matchIndex = match.index;
      if (matchIndex > lastIndex) {
        parts.push(cleanLine.substring(lastIndex, matchIndex));
      }
      parts.push(<strong key={matchIndex} className="font-semibold text-foreground">{match[1]}</strong>);
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < cleanLine.length) {
      parts.push(cleanLine.substring(lastIndex));
    }

    if (isBullet) {
      return (
        <ul key={idx} className="list-disc pl-5 my-1 text-muted-foreground">
          <li>{parts.length > 0 ? parts : cleanLine}</li>
        </ul>
      );
    }

    return (
      <p key={idx} className="mb-2 last:mb-0">
        {parts.length > 0 ? parts : cleanLine}
      </p>
    );
  });
}

function Playground() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Msg[]>(initial);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState<number>(-1);
  const [selected, setSelected] = useState<number | null>(null);
  const [scenario, setScenario] = useState("healthy");
  const [traceId, setTraceId] = useState("a4f9c8");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Dynamic execution steps, matching the pipeline names
  const [steps, setSteps] = useState<any[]>([
    { name: "Prompt Parser", status: "ok", latency: 0, duration: 0, cost: 0, tokens: 0, errors: 0, retries: 0, start_time: 0 },
    { name: "Retriever (ChromaDB)", status: "ok", latency: 0, duration: 0, cost: 0, tokens: 0, errors: 0, retries: 0, start_time: 0 },
    { name: "Embedding (text-3-small)", status: "ok", latency: 0, duration: 0, cost: 0, tokens: 0, errors: 0, retries: 0, start_time: 0 },
    { name: "LLM Router", status: "ok", latency: 0, duration: 0, cost: 0, tokens: 0, errors: 0, retries: 0, start_time: 0 },
    { name: "Weather Tool (JMA)", status: "ok", latency: 0, duration: 0, cost: 0, tokens: 0, errors: 0, retries: 0, start_time: 0 },
    { name: "Validator (Pydantic)", status: "ok", latency: 0, duration: 0, cost: 0, tokens: 0, errors: 0, retries: 0, start_time: 0 },
    { name: "Responder (Stream)", status: "ok", latency: 0, duration: 0, cost: 0, tokens: 0, errors: 0, retries: 0, start_time: 0 },
  ]);

  const [apiKeyConfigured, setApiKeyConfigured] = useState<boolean>(true);

  useEffect(() => {
    fetch("http://localhost:8000/api/settings/diagnostics")
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data.gemini_api_key_configured !== "undefined") {
          setApiKeyConfigured(data.gemini_api_key_configured);
        }
      })
      .catch((err) => {
        console.warn("Failed to fetch diagnostics for API key check:", err);
      });
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, running]);

  const send = async () => {
    if (!input.trim() || running) return;
    
    // Add user message and prepare streaming assistant row
    const userText = input.trim();
    setMessages((m) => [...m, { role: "user", text: userText }, { role: "assistant", text: "" }]);
    setInput("");
    setStep(0);
    setRunning(true);

    // Reset steps state for this new execution run
    setSteps([
      { name: "Prompt Parser", status: "ok", latency: 0, duration: 0, cost: 0, tokens: 0, errors: 0, retries: 0, start_time: 0 },
      { name: "Retriever (ChromaDB)", status: "ok", latency: 0, duration: 0, cost: 0, tokens: 0, errors: 0, retries: 0, start_time: 0 },
      { name: "Embedding (text-3-small)", status: "ok", latency: 0, duration: 0, cost: 0, tokens: 0, errors: 0, retries: 0, start_time: 0 },
      { name: "LLM Router", status: "ok", latency: 0, duration: 0, cost: 0, tokens: 0, errors: 0, retries: 0, start_time: 0 },
      { name: "Weather Tool (JMA)", status: "ok", latency: 0, duration: 0, cost: 0, tokens: 0, errors: 0, retries: 0, start_time: 0 },
      { name: "Validator (Pydantic)", status: "ok", latency: 0, duration: 0, cost: 0, tokens: 0, errors: 0, retries: 0, start_time: 0 },
      { name: "Responder (Stream)", status: "ok", latency: 0, duration: 0, cost: 0, tokens: 0, errors: 0, retries: 0, start_time: 0 },
    ]);

    try {
      const response = await fetch("http://localhost:8000/api/playground/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: userText,
          scenario_id: scenario,
          agent_name: "weather-agent"
        })
      });

      if (!response.ok || !response.body) {
        setRunning(false);
        setMessages((m) => [...m.slice(0, -1), { role: "assistant", text: "Failed to connect to the backend execution service." }]);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            try {
              const dataPayload = JSON.parse(line.slice(6));
              handleExecutionEvent(currentEvent, dataPayload);
            } catch (e) {
              console.error("Failed to parse event JSON data", e);
            }
          }
        }
      }
    } catch (err) {
      console.error("Execution error:", err);
      setRunning(false);
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", text: "Error encountered while invoking ExecutionService." }]);
    }
  };

  const handleExecutionEvent = (eventType: string, data: any) => {
    const payload = data.payload;
    const tId = data.traceId;

    setTraceId(tId);

    if (eventType === "NODE_STARTED") {
      const nodeName = payload.node_name;
      if (nodeName === "Pipeline") return; // Skip top-level wrap start

      const idx = nodeIndexMap[nodeName];
      if (idx !== undefined) {
        setStep(idx);
        setSteps((prev) => {
          const nextSteps = [...prev];
          nextSteps[idx] = {
            ...nextSteps[idx],
            start_time: Date.now(),
            status: "ok"
          };
          return nextSteps;
        });
      }
    } 
    else if (eventType === "NODE_COMPLETED") {
      const nodeName = payload.node_name;
      const idx = nodeIndexMap[nodeName];
      if (idx !== undefined) {
        setSteps((prev) => {
          const nextSteps = [...prev];
          const item = nextSteps[idx];
          const elapsed = item.start_time > 0 ? Date.now() - item.start_time : 100;
          nextSteps[idx] = {
            ...item,
            latency: elapsed,
            duration: elapsed,
            cost: payload.metrics.cost_delta,
            tokens: payload.metrics.token_delta,
            status: item.errors > 0 ? "err" : item.retries > 0 ? "warn" : "ok"
          };
          return nextSteps;
        });
      }
    } 
    else if (eventType === "TOKEN_STREAM") {
      const token = payload.token;
      setMessages((prev) => {
        const nextMsgs = [...prev];
        const lastMsg = nextMsgs[nextMsgs.length - 1];
        if (lastMsg && lastMsg.role === "assistant") {
          nextMsgs[nextMsgs.length - 1] = {
            ...lastMsg,
            text: lastMsg.text + token
          };
        }
        return nextMsgs;
      });
    } 
    else if (eventType === "RETRY") {
      const nodeName = payload.node_name;
      const idx = nodeIndexMap[nodeName];
      if (idx !== undefined) {
        setSteps((prev) => {
          const nextSteps = [...prev];
          nextSteps[idx] = {
            ...nextSteps[idx],
            retries: nextSteps[idx].retries + 1,
            status: "warn"
          };
          return nextSteps;
        });
      }
    } 
    else if (eventType === "ERROR") {
      const nodeName = payload.node_name;
      const idx = nodeIndexMap[nodeName];
      if (idx !== undefined) {
        setSteps((prev) => {
          const nextSteps = [...prev];
          nextSteps[idx] = {
            ...nextSteps[idx],
            errors: nextSteps[idx].errors + 1,
            status: "err"
          };
          return nextSteps;
        });
      }
    } 
    else if (eventType === "FINISHED") {
      setRunning(false);
      setStep(pipeline.length - 1);
      
      // Save trace ID to local storage so other views can inspect it
      localStorage.setItem("active_trace_id", tId);
    }
  };

  return (
    <AppShell
      title="Playground"
      subtitle="Interactive"
      actions={
        <>
          <select 
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-[13px] font-medium transition-all outline-none focus:border-primary/40 cursor-pointer text-foreground mr-1"
          >
            <option value="healthy">Healthy Route</option>
            <option value="high_latency">High Latency</option>
            <option value="retry_storm">Retry Storm</option>
            <option value="api_failure">API Failure</option>
            <option value="cache_miss">Cache Miss</option>
            <option value="expensive_prompt">Expensive Prompt</option>
            <option value="validation_failure">Validation Failure</option>
          </select>
          <PageAction icon={Zap}>{apiKeyConfigured ? "Gemini 2.5" : "Offline Demo"}</PageAction>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        {/* Chat */}
        <div className="card-elevated flex h-[720px] flex-col overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-primary/15">
                <Sparkles className="h-3 w-3 text-primary-foreground" />
              </span>
              <p className="text-sm font-medium">Weather Agent</p>
              <span className="rounded-full border border-border bg-elevated px-2 py-0.5 font-mono text-[10px] text-muted-foreground">v0.14</span>
            </div>
            <div className="flex items-center gap-1 rounded-full border border-border bg-elevated p-0.5 text-[11px]">
              <button className="rounded-full bg-surface px-2.5 py-1 text-foreground">Chat</button>
              <button className="rounded-full px-2.5 py-1 text-muted-foreground hover:text-foreground">Prompt</button>
              <button className="rounded-full px-2.5 py-1 text-muted-foreground hover:text-foreground">Tools</button>
            </div>
          </div>

          {!apiKeyConfigured && (
            <div className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-5 py-2.5 text-xs text-amber-400 font-mono">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>Offline simulated mode. Add <strong>GEMINI_API_KEY</strong> to <code>backend/.env</code> for real models.</span>
            </div>
          )}

          <div ref={scrollRef} className="flex-1 space-y-6 overflow-y-auto px-5 py-6 md:px-8">
            {messages.map((m, i) => (
              <div key={i} className={`flex items-start gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${m.role === "user" ? "bg-primary/20 text-primary-foreground" : "bg-elevated text-muted-foreground"}`}>
                  {m.role === "user" ? <User className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                </div>
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-[14px] leading-relaxed animate-fade-in ${
                  m.role === "user"
                    ? "bg-primary/15 text-foreground border border-primary/25"
                    : "border border-border bg-surface/60"
                }`}>
                  <div>{renderFormattedText(m.text)}</div>
                  {m.role === "assistant" && i === messages.length - 1 && !running && traceId && (
                    <div className="mt-3 pt-2.5 border-t border-border/40 flex items-center justify-between gap-4">
                      <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Trace #{traceId} captured</span>
                      <button
                        onClick={() => navigate({ to: "/app/replay" })}
                        className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:opacity-90 transition-all cursor-pointer"
                      >
                        Inspect Trace
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {running && (
              <div className="flex items-start gap-3">
                <div className="grid h-7 w-7 place-items-center rounded-lg bg-elevated text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5" />
                </div>
                <div className="rounded-2xl border border-border bg-surface/60 px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary/80 animate-pulse-soft" />
                    <span className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-pulse-soft" style={{ animationDelay: "150ms" }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-pulse-soft" style={{ animationDelay: "300ms" }} />
                    <span className="ml-2 text-[11px] font-mono text-muted-foreground">tracing step {Math.max(step, 0) + 1} / {pipeline.length}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* pipeline strip */}
          <div className="border-t border-border bg-background/40 px-4 py-3">
            <PipelineFlow
              compact
              activeIndex={running ? step : pipeline.length - 1}
              nodes={pipeline.map((p, i) => ({ ...p, icon: defaultPipeline[i]?.icon ?? defaultPipeline[0].icon }))}
            />
          </div>

          {/* composer */}
          <div className="border-t border-border p-3 md:p-4">
            <div className="flex items-end gap-2 rounded-2xl border border-border bg-elevated/60 p-2 focus-within:border-primary/40 transition">
              <button className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground hover:bg-elevated hover:text-foreground transition">
                <Paperclip className="h-4 w-4" />
              </button>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Ask your agent…"
                rows={1}
                className="max-h-40 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
              />
              <button
                onClick={send}
                disabled={!input.trim() || running}
                className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 px-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Every request is traced · ⌘⏎ to send
            </p>
          </div>
        </div>

        {/* Execution panel */}
        <div className="card-elevated flex h-[720px] flex-col overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Execution</p>
              <h3 className="text-sm font-semibold">Trace #{traceId}</h3>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-border bg-elevated px-2.5 py-1 text-[11px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-soft" />
              {running ? "streaming" : "complete"}
            </div>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {steps.map((s, i) => {
              const isCurrent = running && step === i;
              const done = !running || i <= step;
              return (
                <button
                  key={s.name}
                  onClick={() => setSelected(i)}
                  className={`w-full rounded-xl border p-3.5 text-left transition-all animate-fade-in ${
                    isCurrent
                      ? "border-primary/40 bg-primary/[0.06]"
                      : done
                      ? "border-border bg-surface/60 hover:bg-elevated"
                      : "border-border bg-background/40 opacity-50"
                  }`}
                  style={{ animationDelay: `${i * 30}ms` }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <StepStatus status={s.status} pulsing={isCurrent} />
                      <p className="truncate text-[13px] font-medium">{s.name}</p>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="mt-2.5 grid grid-cols-4 gap-1.5 text-[10px] font-mono uppercase tracking-wider">
                    <Metric icon={Clock} value={`${s.latency || 0}ms`} />
                    <Metric icon={Coins} value={`$${(s.cost || 0).toFixed(4)}`} />
                    <Metric icon={Zap} value={`${s.tokens || 0}t`} />
                    <Metric icon={s.retries ? RotateCw : AlertTriangle} value={`${s.retries || s.errors || 0}`} tone={s.retries ? "warn" : s.errors ? "err" : "muted"} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Side drawer */}
      {selected !== null && (
        <div className="fixed inset-0 z-40" onClick={() => setSelected(null)}>
          <div className="absolute inset-0 bg-background/70 backdrop-blur-sm animate-fade-in" />
          <aside
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-0 h-full w-full max-w-[520px] overflow-y-auto border-l border-border bg-surface/95 backdrop-blur-2xl p-6 animate-fade-in"
            style={{ animation: "fade-in 0.35s ease-out" }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Span detail</p>
                <h3 className="mt-1 text-xl font-semibold tracking-tight">{steps[selected].name}</h3>
              </div>
              <button onClick={() => setSelected(null)} className="grid h-9 w-9 place-items-center rounded-full border border-border bg-elevated hover:bg-surface">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              {[
                ["Latency", `${steps[selected].latency || 0} ms`],
                ["Duration", `${steps[selected].duration || 0} ms`],
                ["Cost", `$${(steps[selected].cost || 0).toFixed(4)}`],
                ["Tokens", `${steps[selected].tokens || 0}`],
                ["Errors", `${steps[selected].errors || 0}`],
                ["Retries", `${steps[selected].retries || 0}`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-border bg-elevated/60 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{k}</p>
                  <p className="mt-1 text-lg font-semibold">{v}</p>
                </div>
              ))}
            </div>

            <div className="mt-6">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Attributes</p>
              <div className="mt-2 rounded-xl border border-border bg-background/60 p-4 font-mono text-[12px] leading-relaxed">
                <div><span className="text-muted-foreground">otel.kind</span> = "internal"</div>
                <div><span className="text-muted-foreground">agent.node_name</span> = "{steps[selected].name}"</div>
                <div><span className="text-muted-foreground">agent.status</span> = "{steps[selected].status}"</div>
                {steps[selected].tokens > 0 && <div><span className="text-muted-foreground">gen_ai.usage.tokens</span> = {steps[selected].tokens}</div>}
                {steps[selected].cost > 0 && <div><span className="text-muted-foreground">gen_ai.usage.cost</span> = ${steps[selected].cost.toFixed(5)}</div>}
                {steps[selected].retries > 0 && <div><span className="text-muted-foreground">agent.retries</span> = {steps[selected].retries}</div>}
                {steps[selected].errors > 0 && <div><span className="text-muted-foreground">agent.errors</span> = {steps[selected].errors}</div>}
              </div>
            </div>
          </aside>
        </div>
      )}
    </AppShell>
  );
}

function StepStatus({ status, pulsing }: { status: string; pulsing?: boolean }) {
  const color = status === "ok" ? "bg-success" : status === "warn" ? "bg-warning" : "bg-destructive";
  return <span className={`grid h-2 w-2 rounded-full ${color} ${pulsing ? "animate-pulse-soft" : ""}`} />;
}

function Metric({ icon: Icon, value, tone = "muted" }: { icon: typeof Clock; value: string; tone?: "muted" | "warn" | "err" }) {
  const c = tone === "warn" ? "text-warning" : tone === "err" ? "text-destructive" : "text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1 ${c}`}>
      <Icon className="h-2.5 w-2.5" />
      {value}
    </span>
  );
}
