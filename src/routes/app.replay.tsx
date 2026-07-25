import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageAction } from "@/components/AppShell";
import { PipelineFlow } from "@/components/PipelineFlow";
import { useEffect, useState } from "react";
import { Play, Pause, ZoomIn, ZoomOut, SkipBack, SkipForward, Search, Sparkles, Zap, Clock, Waypoints, X } from "lucide-react";

export const Route = createFileRoute("/app/replay")({
  component: Replay,
});

const reconstructSpansFromEvents = (events: any[]) => {
  if (!events || events.length === 0) return [];
  
  const firstEventTime = new Date(events[0].timestamp).getTime();
  const nodeMap: Record<string, { start_time: number, end_time?: number, cost: number, tokens: number, retries: number, errors: number, has_failed: boolean, events: any[] }> = {};
  
  for (const ev of events) {
    const payload = typeof ev.payload === "string" ? JSON.parse(ev.payload) : ev.payload;
    let nodeName = payload?.node_name;
    
    if (!nodeName) {
      if (ev.event_type.startsWith("VALIDATION")) {
        nodeName = "Validator (Pydantic)";
      } else if (ev.event_type.startsWith("RETRIEVAL")) {
        nodeName = "Retriever (ChromaDB)";
      }
    }
    
    if (!nodeName || nodeName === "Pipeline") continue;
    
    const time = new Date(ev.timestamp).getTime();
    
    if (!nodeMap[nodeName]) {
      nodeMap[nodeName] = {
        start_time: time,
        cost: 0,
        tokens: 0,
        retries: 0,
        errors: 0,
        has_failed: false,
        events: []
      };
    }
    
    nodeMap[nodeName].events.push({ event_type: ev.event_type, payload });
    
    if (ev.event_type === "NODE_STARTED") {
      nodeMap[nodeName].start_time = time;
    } 
    else if (ev.event_type === "NODE_COMPLETED") {
      nodeMap[nodeName].end_time = time;
      if (payload.metrics) {
        nodeMap[nodeName].cost = payload.metrics.cost_delta || 0;
        nodeMap[nodeName].tokens = payload.metrics.token_delta || 0;
      }
    } 
    else if (ev.event_type === "RETRY") {
      nodeMap[nodeName].retries += 1;
    } 
    else if (ev.event_type === "ERROR") {
      nodeMap[nodeName].errors += 1;
      nodeMap[nodeName].has_failed = true;
    }
  }
  
  const reconstructed: any[] = [];
  Object.entries(nodeMap).forEach(([name, data]) => {
    const offset = data.start_time - firstEventTime;
    const dur = data.end_time ? (data.end_time - data.start_time) : 200; // default 200ms fallback
    
    let color = "primary";
    let kind = "internal";
    if (name.includes("Retriever")) {
      color = "primary";
      kind = "db";
    } else if (name.includes("Embedding")) {
      color = "primary";
      kind = "client";
    } else if (name.includes("Router") || name.includes("Responder")) {
      color = "info";
      kind = "client";
    } else if (name.includes("Tool")) {
      color = "warning";
      kind = "tool";
    } else if (name.includes("Validator")) {
      color = "warning";
      kind = "internal";
    }
    
    reconstructed.push({
      name,
      start: offset,
      dur: Math.max(10, dur),
      kind,
      color,
      cost: data.cost,
      tokens: data.tokens,
      retries: data.retries,
      errors: data.errors,
      status: data.errors > 0 ? "failed" : data.retries > 0 ? "degraded" : "completed",
      events: data.events
    });
  });
  
  return reconstructed;
};

function Replay() {
  const [events, setEvents] = useState<any[]>([]);
  const [spans, setSpans] = useState<any[]>([]);
  const [totalDuration, setTotalDuration] = useState(500);
  const [activeTraceId, setActiveTraceId] = useState("a4f9c8");
  const [loading, setLoading] = useState(true);

  const [playing, setPlaying] = useState(true);
  const [t, setT] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    const fetchTrace = async () => {
      const activeId = localStorage.getItem("active_trace_id") || "inv_test_run";
      setActiveTraceId(activeId);
      
      try {
        const response = await fetch(`http://localhost:8000/api/replay/${activeId}/events`);
        if (response.ok) {
          const rawEvents = await response.json();
          setEvents(rawEvents);
          
          const reconstructed = reconstructSpansFromEvents(rawEvents);
          setSpans(reconstructed);
          
          const finished = rawEvents.find((e: any) => e.event_type === "FINISHED");
          let total = 500;
          if (finished) {
            const payload = typeof finished.payload === "string" ? JSON.parse(finished.payload) : finished.payload;
            total = payload.duration_ms || 500;
          } else if (rawEvents.length > 1) {
            const start = new Date(rawEvents[0].timestamp).getTime();
            const end = new Date(rawEvents[rawEvents.length - 1].timestamp).getTime();
            total = end - start;
          }
          setTotalDuration(Math.max(100, total));
        }
      } catch (err) {
        console.error("Failed to load trace events:", err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchTrace();
  }, []);

  useEffect(() => {
    if (!playing || spans.length === 0) return;
    const frameMs = 50;
    const id = setInterval(() => {
      setT((v) => {
        const nextVal = v + (frameMs * speed);
        return nextVal >= totalDuration ? 0 : nextVal;
      });
    }, frameMs);
    return () => clearInterval(id);
  }, [playing, speed, totalDuration, spans]);

  if (loading) {
    return (
      <AppShell title="Replay" subtitle="Loading telemetry...">
        <div className="flex h-[400px] items-center justify-center rounded-2xl border border-border bg-surface/40 backdrop-blur-xl">
          <div className="text-center">
            <span className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin inline-block" />
            <p className="mt-3 text-sm text-muted-foreground animate-pulse">Reading flight recorder events...</p>
          </div>
        </div>
      </AppShell>
    );
  }

  const activeStep = Math.min(6, Math.floor((t / totalDuration) * 7));
  const finishedEvent = events.find((e: any) => e.event_type === "FINISHED");
  const finishedPayload = finishedEvent
    ? (typeof finishedEvent.payload === "string" ? JSON.parse(finishedEvent.payload) : finishedEvent.payload)
    : null;

  const totalTokens = finishedPayload?.tokens || spans.reduce((acc, s) => acc + (s.tokens || 0), 0);

  return (
    <AppShell
      title="Replay"
      subtitle={`Trace #${activeTraceId} · ${totalDuration}ms`}
      actions={
        <>
          <PageAction icon={Search}>Find span</PageAction>
          <PageAction variant="primary" icon={Sparkles}>Ask detective</PageAction>
        </>
      }
    >
      {/* Live pipeline preview */}
      <div className="card-elevated rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Journey · replaying</p>
            <h3 className="mt-1 text-lg font-semibold">weather-agent · /chat</h3>
          </div>
          <div className="flex items-center gap-2">
            <Chip icon={Clock}>{t.toFixed(0)} ms</Chip>
            <Chip icon={Zap}>{totalTokens.toLocaleString()} tokens</Chip>
            <Chip icon={Waypoints}>{spans.length} spans</Chip>
          </div>
        </div>
        <div className="mt-6 rounded-xl border border-border bg-background/40 p-5">
          <PipelineFlow activeIndex={activeStep} />
        </div>
      </div>

      {/* Timeline */}
      <div className="mt-6 card-elevated rounded-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-full border border-border bg-elevated p-1">
              <TimelineBtn onClick={() => setT(0)}><SkipBack className="h-3.5 w-3.5" /></TimelineBtn>
              <TimelineBtn onClick={() => setPlaying((p) => !p)} primary>
                {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </TimelineBtn>
              <TimelineBtn onClick={() => setT(totalDuration - 10)}><SkipForward className="h-3.5 w-3.5" /></TimelineBtn>
            </div>
            
            {/* Playback speed selector */}
            <select 
              value={speed} 
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="rounded-full border border-border bg-elevated px-3 py-1 font-mono text-[10px] text-muted-foreground outline-none cursor-pointer hover:text-foreground transition"
            >
              <option value="0.5">0.5x</option>
              <option value="1">1.0x</option>
              <option value="2">2.0x</option>
              <option value="4">4.0x</option>
            </select>
          </div>

          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] text-muted-foreground">
              {t.toFixed(0)} / {totalDuration} ms
            </span>
            <div className="flex items-center gap-1 rounded-full border border-border bg-elevated p-1">
              <TimelineBtn onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}><ZoomOut className="h-3.5 w-3.5" /></TimelineBtn>
              <span className="px-2 font-mono text-[11px] text-muted-foreground">{Math.round(zoom * 100)}%</span>
              <TimelineBtn onClick={() => setZoom((z) => Math.min(3, z + 0.25))}><ZoomIn className="h-3.5 w-3.5" /></TimelineBtn>
            </div>
          </div>
        </div>

        {/* Timeline ruler */}
        <div className="relative overflow-x-auto">
          <div style={{ width: `${100 * zoom}%`, minWidth: "100%" }} className="relative">
            {/* ruler */}
            <div className="relative flex h-8 border-b border-border">
              {Array.from({ length: 11 }).map((_, i) => (
                <div key={i} className="flex-1 border-l border-border/60 px-2 pt-1.5 first:border-l-0">
                  <span className="font-mono text-[10px] text-muted-foreground">{Math.round((i / 10) * totalDuration)}ms</span>
                </div>
              ))}
            </div>

            {/* rows */}
            <div className="relative">
              {spans.map((s, i) => {
                const left = (s.start / totalDuration) * 100;
                const width = (s.dur / totalDuration) * 100;
                const active = t >= s.start && t <= s.start + s.dur;
                const barColor =
                  s.status === "failed" ? "from-destructive/80 to-destructive/40" :
                  s.status === "degraded" ? "from-warning/80 to-warning/40" :
                  s.color === "primary" ? "from-primary/80 to-primary/40" :
                  s.color === "info" ? "from-info/80 to-info/40" :
                  s.color === "warning" ? "from-warning/80 to-warning/40" :
                  "from-muted-foreground/40 to-muted-foreground/20";
                return (
                  <div 
                    key={i} 
                    onClick={() => setSelected(i)}
                    className="group relative flex h-9 items-center border-b border-border/40 hover:bg-elevated/40 cursor-pointer"
                  >
                    <div
                      className={`absolute top-1/2 -translate-y-1/2 h-4 rounded-md bg-gradient-to-r ${barColor} border border-white/10 transition-all ${active ? "ring-1 ring-primary/60 shadow-glow" : ""}`}
                      style={{ left: `${left}%`, width: `max(2px, ${width}%)`, boxShadow: active ? "0 0 20px -4px oklch(0.68 0.19 275 / 0.6)" : undefined }}
                    />
                    <div className="pointer-events-none absolute left-3 flex items-center gap-2 font-mono text-[11px]">
                      <span className={active ? "text-foreground" : "text-muted-foreground"}>{s.name}</span>
                      <span className="text-muted-foreground/60">{s.dur.toFixed(0)}ms</span>
                      {s.retries > 0 && <span className="text-warning text-[9px] border border-warning/30 bg-warning/10 px-1 rounded">x{s.retries} retry</span>}
                      {s.errors > 0 && <span className="text-destructive text-[9px] border border-destructive/30 bg-destructive/10 px-1 rounded">error</span>}
                    </div>
                  </div>
                );
              })}

              {/* playhead */}
              <div
                className="pointer-events-none absolute inset-y-0 w-px bg-primary shadow-[0_0_16px_oklch(0.68_0.19_275_/_0.6)]"
                style={{ left: `${(t / totalDuration) * 100}%` }}
              >
                <span className="absolute -top-1 -translate-x-1/2 h-2 w-2 rounded-full bg-primary animate-pulse-soft" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Static AI Detective mockup as per requirements */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="card-elevated relative overflow-hidden rounded-2xl p-6 lg:col-span-2">
          <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full" style={{ background: "radial-gradient(closest-side, oklch(0.7 0.17 300 / 0.25), transparent)" }} />
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-primary/60 to-primary/20">
              <Sparkles className="h-3.5 w-3.5 text-primary-foreground" />
            </span>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">AI Detective</p>
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary-foreground/90">92% confidence</span>
          </div>
          <h3 className="mt-4 text-xl font-semibold tracking-tight md:text-2xl">Root cause analysis</h3>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Retriever latency increased by <span className="text-foreground">+240ms</span> on this trace due to a <span className="text-foreground">cache miss</span> on the semantic index. The upstream vector query executed cold against pgvector.
          </p>
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <MiniStat label="Estimated impact" value="+2.1s" tone="warn" />
            <MiniStat label="Recurrence" value="14% of req" />
            <MiniStat label="Confidence" value="92%" tone="ok" />
          </div>
          <div className="mt-6 rounded-xl border border-border bg-background/60 p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Suggested optimization</p>
            <p className="mt-1.5 text-[14px]">Enable semantic cache with a 5-min TTL on the retriever adapter. Preload top-100 embeddings during cold start.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="rounded-full bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">Apply fix</button>
              <button className="rounded-full border border-border bg-elevated px-3.5 py-1.5 text-xs hover:bg-surface">Open runbook</button>
            </div>
          </div>
        </div>

        <div className="card-elevated rounded-2xl p-6">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Comparable traces</p>
          <h3 className="mt-1 text-base font-semibold">Similar patterns</h3>
          <ul className="mt-4 space-y-3">
            {[
              { id: "trc_8b2e1", dur: "498ms", delta: "-14ms" },
              { id: "trc_71a92", dur: "612ms", delta: "+100ms" },
              { id: "trc_4c8f3", dur: "441ms", delta: "-71ms" },
              { id: "trc_29d64", dur: "578ms", delta: "+66ms" },
            ].map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-xl border border-border bg-elevated/50 px-3 py-2.5 text-sm hover:bg-elevated transition">
                <span className="font-mono text-[12px]">{r.id}</span>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[11px] text-muted-foreground">{r.dur}</span>
                  <span className={`font-mono text-[11px] ${r.delta.startsWith("+") ? "text-warning" : "text-success"}`}>{r.delta}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Side drawer details for clicked span */}
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
                <h3 className="mt-1 text-xl font-semibold tracking-tight">{spans[selected].name}</h3>
              </div>
              <button onClick={() => setSelected(null)} className="grid h-9 w-9 place-items-center rounded-full border border-border bg-elevated hover:bg-surface">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              {[
                ["Latency", `${spans[selected].dur.toFixed(0)} ms`],
                ["Type", `${spans[selected].kind}`],
                ["Cost", `$${(spans[selected].cost || 0).toFixed(4)}`],
                ["Tokens", `${spans[selected].tokens || 0}`],
                ["Errors", `${spans[selected].errors || 0}`],
                ["Retries", `${spans[selected].retries || 0}`],
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
                <div><span className="text-muted-foreground">otel.kind</span> = "{spans[selected].kind}"</div>
                <div><span className="text-muted-foreground">agent.node_name</span> = "{spans[selected].name}"</div>
                <div><span className="text-muted-foreground">agent.status</span> = "{spans[selected].status}"</div>
                {spans[selected].tokens > 0 && <div><span className="text-muted-foreground">gen_ai.usage.tokens</span> = {spans[selected].tokens}</div>}
                {spans[selected].cost > 0 && <div><span className="text-muted-foreground">gen_ai.usage.cost</span> = ${spans[selected].cost.toFixed(5)}</div>}
                {spans[selected].retries > 0 && <div><span className="text-muted-foreground">agent.retries</span> = {spans[selected].retries}</div>}
                {spans[selected].errors > 0 && <div><span className="text-muted-foreground">agent.errors</span> = {spans[selected].errors}</div>}
              </div>
            </div>

            {/* ChromaDB Retrieval Sub-panel */}
            {spans[selected].name.includes("Retriever") && (
              <div className="mt-6">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Retrieved Chunks (ChromaDB)</p>
                <div className="mt-2 space-y-2">
                  {(() => {
                    const retEv = spans[selected].events?.find((e: any) => e.event_type === "RETRIEVAL_COMPLETED");
                    const docs = retEv?.payload?.documents || [];
                    if (docs.length === 0) {
                      return <p className="text-xs text-muted-foreground italic">No document chunks matches found.</p>;
                    }
                    return docs.map((doc: any, i: number) => (
                      <div key={i} className="rounded-xl border border-border bg-background/40 p-3 text-xs">
                        <div className="flex items-center justify-between text-muted-foreground font-mono text-[9px] uppercase tracking-wider mb-2">
                          <span>{doc.source_file} &middot; {doc.section}</span>
                          <span className="text-success font-semibold">{(doc.score * 100).toFixed(0)}% Match</span>
                        </div>
                        <p className="text-foreground/90 leading-relaxed font-sans">{doc.text}</p>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}

            {/* Pydantic Validation History Sub-panel */}
            {spans[selected].name.includes("Validator") && (
              <div className="mt-6">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Pydantic Validation History</p>
                <div className="mt-2 space-y-2">
                  {(() => {
                    const valFailures = spans[selected].events?.filter((e: any) => e.event_type === "VALIDATION_FAILURE" || e.event_type === "VALIDATION_RETRY") || [];
                    if (valFailures.length === 0) {
                      return (
                        <div className="rounded-xl border border-success/20 bg-success/10 p-3 text-xs text-success flex items-center gap-1.5">
                          <span>✓ Schema validated successfully on first attempt.</span>
                        </div>
                      );
                    }
                    return valFailures.map((ev: any, i: number) => {
                      const isRetry = ev.event_type === "VALIDATION_RETRY";
                      const title = isRetry ? `VALIDATION RETRY ATTEMPT #${ev.payload.attempt}` : "VALIDATION FAILURE";
                      const c = isRetry ? "text-warning" : "text-destructive";
                      return (
                        <div key={i} className="rounded-xl border border-border bg-background/40 p-3 text-xs space-y-1">
                          <p className={`font-mono text-[10px] font-semibold tracking-wider ${c}`}>{title}</p>
                          <p className="text-muted-foreground leading-relaxed font-sans mt-1">{ev.payload.error_message}</p>
                          {ev.payload.invalid_response && (
                            <pre className="mt-2 p-2 bg-black/40 rounded text-[10px] font-mono text-foreground overflow-x-auto max-h-32 leading-normal">
                              {ev.payload.invalid_response}
                            </pre>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </AppShell>
  );
}

function TimelineBtn({ children, onClick, primary }: { children: React.ReactNode; onClick?: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded-full transition ${primary ? "bg-primary text-primary-foreground hover:opacity-90" : "text-muted-foreground hover:bg-surface hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

function Chip({ icon: Icon, children }: { icon: typeof Clock; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-elevated/60 px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
      <Icon className="h-3 w-3" /> {children}
    </span>
  );
}

function MiniStat({ label, value, tone = "muted" }: { label: string; value: string; tone?: "ok" | "warn" | "muted" }) {
  const c = tone === "ok" ? "text-success" : tone === "warn" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-background/50 p-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tracking-tight ${c}`}>{value}</p>
    </div>
  );
}
