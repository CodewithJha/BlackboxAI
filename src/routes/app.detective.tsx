import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageAction } from "@/components/AppShell";
import { PipelineFlow } from "@/components/PipelineFlow";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Radar,
  Rocket,
  ShieldCheck,
  Sparkles,
  Target,
  Wand2,
  Waypoints,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export const Route = createFileRoute("/app/detective")({
  component: Detective,
});

type DetectiveReport = {
  executive_summary: string;
  root_cause: string;
  evidence: Array<{
    event_type: string;
    description: string;
    latency_impact_ms?: number;
  }>;
  optimization_opportunities: Array<{
    title: string;
    description: string;
    est?: string;
  }>;
  estimated_savings?: {
    latency?: string;
    cost?: string;
    win?: string;
  };
  recommended_actions: string[];
  investigation_context?: {
    status?: string;
    duration_ms?: number;
    retries_count?: number;
    errors_count?: number;
    inferred_scenario?: string;
    anomalies_detected?: string[];
  };
};

const defaultReport: DetectiveReport = {
  executive_summary: "No diagnostic report compiled for this investigation.",
  root_cause: "Verify execution logs or rerun analysis from the playground.",
  evidence: [],
  optimization_opportunities: [],
  estimated_savings: { latency: "0ms", cost: "0%", win: "None" },
  recommended_actions: [],
  investigation_context: {},
};

function Detective() {
  const [step, setStep] = useState(0);
  const [report, setReport] = useState<DetectiveReport | null>(null);
  const [activeTraceId, setActiveTraceId] = useState("a4f9c8");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % 7), 900);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const fetchReport = async () => {
      const activeId = localStorage.getItem("active_trace_id") || "inv_test_run";
      setActiveTraceId(activeId);

      try {
        const response = await fetch(`http://localhost:8000/api/detective/${activeId}/report`);
        if (response.ok) {
          const data = await response.json();
          setReport(data);
        }
      } catch (err) {
        console.error("Failed to load AI Detective report:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, []);

  const activeReport = report || defaultReport;
  const context = activeReport.investigation_context || {};
  const anomalies = context.anomalies_detected || [];
  const retries = context.retries_count || 0;
  const errors = context.errors_count || 0;
  const durationMs = context.duration_ms || 0;
  const evidence = activeReport.evidence || [];
  const actions = activeReport.recommended_actions || [];
  const opportunities = activeReport.optimization_opportunities || [];

  const incident = useMemo(() => {
    const status = context.status || "unknown";
    const severity =
      status === "failed" ? "critical" : status === "degraded" || errors > 0 || retries > 0 ? "elevated" : "healthy";
    const confidence = evidence.length >= 2 || anomalies.length >= 2 ? "94%" : evidence.length > 0 ? "87%" : "72%";
    const primaryAction =
      actions[0] ||
      opportunities[0]?.description ||
      "Review this trace against a healthy baseline and validate the agent configuration.";
    const blastRadius =
      status === "failed"
        ? "User-facing response generation stopped before a valid output could be delivered."
        : status === "degraded"
          ? "The user still received an answer, but latency and reliability regressed."
          : "No active incident. This trace can serve as a healthy baseline reference.";

    return {
      status,
      severity,
      confidence,
      primaryAction,
      blastRadius,
    };
  }, [actions, anomalies.length, context.status, errors, evidence.length, opportunities, retries]);

  const latencyImpact = activeReport.estimated_savings?.latency || "0ms";
  const estAfterFix = activeReport.estimated_savings?.win || "None";
  const savingsPct = activeReport.estimated_savings?.cost || "0%";
  const topEvidence = evidence.slice(0, 3);

  if (loading) {
    return (
      <AppShell title="AI Detective" subtitle="Analyzing trace context...">
        <div className="flex h-[400px] items-center justify-center rounded-2xl border border-border bg-surface/40 backdrop-blur-xl">
          <div className="text-center">
            <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="mt-3 animate-pulse text-sm text-muted-foreground">Detective is reconstructing the execution trail...</p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="AI Detective"
      subtitle="From trace to root cause"
      actions={
        <>
          <PageAction icon={Wand2}>Re-run analysis</PageAction>
          <PageAction variant="primary" icon={Rocket}>Apply highest-impact fix</PageAction>
        </>
      }
    >
      <div className="space-y-6">
        <div className="card-elevated relative overflow-hidden rounded-2xl p-6 md:p-8">
          <div
            className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full"
            style={{ background: "radial-gradient(closest-side, oklch(0.7 0.17 300 / 0.28), transparent)" }}
          />
          <div
            className="pointer-events-none absolute -left-32 bottom-0 h-64 w-64 rounded-full"
            style={{ background: "radial-gradient(closest-side, oklch(0.68 0.19 275 / 0.18), transparent)" }}
          />

          <div className="relative">
            <div className="flex flex-wrap items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-primary/70 to-primary/20">
                <Sparkles className="h-3.5 w-3.5 text-primary-foreground" />
              </span>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Case {activeTraceId} · weather-agent</p>
              <SeverityPill severity={incident.severity} status={incident.status} />
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary-foreground/90">
                {incident.confidence} confidence
              </span>
            </div>

            <h2 className="mt-5 max-w-4xl text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
              {activeReport.executive_summary}
            </h2>
            <p className="mt-3 max-w-4xl text-[15px] leading-relaxed text-muted-foreground">
              {activeReport.root_cause}
            </p>

            <div className="mt-6 grid gap-3 lg:grid-cols-3">
              <CalloutCard
                icon={Target}
                eyebrow="Verdict"
                title="Most likely root issue"
                body={topEvidence[0]?.description || activeReport.root_cause}
                tone={incident.severity === "healthy" ? "ok" : "warn"}
              />
              <CalloutCard
                icon={Radar}
                eyebrow="Blast Radius"
                title="What this affected"
                body={incident.blastRadius}
                tone={incident.severity === "critical" ? "warn" : "muted"}
              />
              <CalloutCard
                icon={Rocket}
                eyebrow="Next Move"
                title="Highest-leverage fix"
                body={incident.primaryAction}
                tone="ok"
              />
            </div>

            <div className="mt-8 rounded-2xl border border-border bg-background/50 p-5">
              <PipelineFlow activeIndex={step} />
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-4">
              <Stat icon={Clock} label="Latency to recover" value={latencyImpact} tone="warn" />
              <Stat icon={Zap} label="Expected win" value={estAfterFix} tone="ok" />
              <Stat icon={Waypoints} label="Cost change" value={savingsPct} />
              <Stat icon={ShieldCheck} label="Trace duration" value={durationMs ? `${durationMs}ms` : "n/a"} tone="muted" />
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <div className="space-y-4">
            <div className="card-elevated rounded-2xl p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Cause Chain</p>
                  <h3 className="mt-1 text-lg font-semibold">What happened, in order</h3>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">evidence-backed</span>
              </div>

              {topEvidence.length > 0 ? (
                <div className="mt-5 space-y-3">
                  {topEvidence.map((item, index) => (
                    <div key={`${item.event_type}-${index}`} className="rounded-xl border border-border bg-background/40 p-4">
                      <div className="flex items-start gap-3">
                        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border bg-elevated font-mono text-[11px] text-muted-foreground">
                          {index + 1}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-border bg-elevated px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                              {item.event_type}
                            </span>
                            {typeof item.latency_impact_ms === "number" && (
                              <span className="font-mono text-[11px] text-warning">+{item.latency_impact_ms}ms</span>
                            )}
                          </div>
                          <p className="mt-2 text-sm leading-relaxed text-foreground/95">{item.description}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyBlock copy="No evidence chain is available yet for this trace." />
              )}
            </div>

            <div className="card-elevated rounded-2xl p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Recommendations</p>
                  <h3 className="mt-1 text-lg font-semibold">What to do next</h3>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">prioritized</span>
              </div>

              {actions.length > 0 ? (
                <div className="mt-5 space-y-3">
                  {actions.map((action, index) => (
                    <div key={`${action}-${index}`} className="flex items-start gap-3 rounded-xl border border-border bg-background/40 p-4">
                      <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-success/10 text-[11px] text-success">
                        {index + 1}
                      </div>
                      <p className="text-sm leading-relaxed text-foreground/95">{action}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyBlock copy="No recommended actions were generated for this trace." />
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="card-elevated rounded-2xl p-6">
              <div className="flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-md bg-primary/15">
                  <AlertTriangle className="h-3 w-3 text-primary-foreground" />
                </span>
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Incident Summary</p>
              </div>

              <div className="mt-4 space-y-3">
                <SummaryRow label="Status" value={incident.status || "unknown"} />
                <SummaryRow label="Scenario" value={context.inferred_scenario || "not inferred"} />
                <SummaryRow label="Retries" value={String(retries)} />
                <SummaryRow label="Errors" value={String(errors)} />
                <SummaryRow label="Anomalies" value={String(anomalies.length)} />
              </div>
            </div>

            <div className="card-elevated rounded-2xl p-6">
              <div className="flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-md bg-primary/15">
                  <Wand2 className="h-3 w-3 text-primary-foreground" />
                </span>
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Suggested Optimizations</p>
              </div>

              {opportunities.length > 0 ? (
                <div className="mt-5 space-y-3">
                  {opportunities.map((item, index) => (
                    <div key={`${item.title}-${index}`} className="rounded-xl border border-border bg-background/50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold leading-snug text-foreground/95">{item.title}</p>
                        {item.est && (
                          <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 font-mono text-[10px] text-success">
                            {item.est}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{item.description}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyBlock copy="No optimization opportunities were identified." />
              )}
            </div>

            <div className="card-elevated rounded-2xl p-6">
              <div className="flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-md bg-primary/15">
                  <Sparkles className="h-3 w-3 text-primary-foreground" />
                </span>
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Detected Anomalies</p>
              </div>

              {anomalies.length > 0 ? (
                <ul className="mt-5 space-y-2">
                  {anomalies.slice(0, 5).map((item, index) => (
                    <li key={`${item}-${index}`} className="rounded-xl border border-border bg-background/40 px-3 py-3 text-[13px] leading-relaxed text-muted-foreground">
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyBlock copy="No anomalies were flagged in the execution history." />
              )}

              <div className="mt-5 flex items-center gap-2 rounded-xl border border-success/20 bg-success/5 px-3 py-2.5 text-[12px] text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Highest upside after fix: <span className="font-mono">{estAfterFix}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function SeverityPill({ severity, status }: { severity: string; status: string }) {
  if (severity === "critical") {
    return (
      <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 font-mono text-[10px] text-destructive">
        Critical · {status}
      </span>
    );
  }
  if (severity === "elevated") {
    return (
      <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 font-mono text-[10px] text-warning">
        Elevated · {status}
      </span>
    );
  }
  return (
    <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 font-mono text-[10px] text-success">
      Healthy · {status}
    </span>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone = "muted",
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  tone?: "ok" | "warn" | "muted";
}) {
  const c = tone === "ok" ? "text-success" : tone === "warn" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-background/50 p-3">
      <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <p className={`mt-1.5 text-2xl font-semibold tracking-tight ${c}`}>{value}</p>
    </div>
  );
}

function CalloutCard({
  icon: Icon,
  eyebrow,
  title,
  body,
  tone,
}: {
  icon: typeof Target;
  eyebrow: string;
  title: string;
  body: string;
  tone: "ok" | "warn" | "muted";
}) {
  const toneClass =
    tone === "ok"
      ? "border-success/20 bg-success/5"
      : tone === "warn"
        ? "border-warning/20 bg-warning/5"
        : "border-border bg-background/40";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <Icon className="h-3 w-3" /> {eyebrow}
      </p>
      <h3 className="mt-2 text-sm font-semibold text-foreground/95">{title}</h3>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/30 py-2 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right font-mono text-[11px] uppercase tracking-wider text-foreground/90">{value}</span>
    </div>
  );
}

function EmptyBlock({ copy }: { copy: string }) {
  return (
    <div className="mt-5 rounded-xl border border-dashed border-border/70 bg-background/20 p-5 text-center text-xs text-muted-foreground">
      {copy}
    </div>
  );
}
