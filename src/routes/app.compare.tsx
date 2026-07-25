import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { GitCompare, ArrowRight, Sparkles, Clock, Zap, DollarSign, Waypoints, TrendingUp, TrendingDown, AlertTriangle, ShieldCheck, HelpCircle } from "lucide-react";

export const Route = createFileRoute("/app/compare")({
  component: Compare,
});

interface Investigation {
  id: string;
  title: string;
  agent_name: string;
  status: string;
  duration_ms: number;
  cost: number;
  total_tokens: number;
  error_count: number;
  retry_count: number;
  created_at: string;
}

interface CompareResponse {
  run_a: {
    id: string;
    title: string;
    latency_ms: number;
    tokens: number;
    cost: number;
    retries: number;
    errors: number;
    status: string;
  };
  run_b: {
    id: string;
    title: string;
    latency_ms: number;
    tokens: number;
    cost: number;
    retries: number;
    errors: number;
    status: string;
  };
  metrics_diff: {
    latency_diff_ms: number;
    tokens_diff: number;
    cost_diff: number;
    retries_diff: number;
    errors_diff: number;
    winner: string;
    score_delta: number;
    primary_reason: string;
  };
  narrative: {
    headline: string;
    explanation: string;
  };
}

function Compare() {
  const [runAId, setRunAId] = useState<string>("");
  const [runBId, setRunBId] = useState<string>("");

  // 1. Fetch list of all investigations
  const { data: investigations = [], isLoading: isListLoading } = useQuery<Investigation[]>({
    queryKey: ["investigations"],
    queryFn: async () => {
      const res = await fetch("http://localhost:8000/api/investigations");
      if (!res.ok) throw new Error("Failed to load investigations");
      return res.json();
    }
  });

  // Automatically select the last two runs when list completes loading
  useEffect(() => {
    if (investigations.length >= 2) {
      if (!runAId) setRunAId(investigations[1].id); // Second latest
      if (!runBId) setRunBId(investigations[0].id); // Latest
    } else if (investigations.length === 1) {
      if (!runAId) setRunAId(investigations[0].id);
    }
  }, [investigations]);

  // 2. Fetch comparison metrics and narrative report
  const { data: report, isLoading: isReportLoading, error } = useQuery<CompareResponse>({
    queryKey: ["compareReport", runAId, runBId],
    queryFn: async () => {
      const res = await fetch(`http://localhost:8000/api/compare/${runAId}/${runBId}/report`);
      if (!res.ok) throw new Error("Failed to fetch compare report");
      return res.json();
    },
    enabled: !!runAId && !!runBId && runAId !== runBId
  });

  if (isListLoading) {
    return (
      <AppShell title="Compare Runs" subtitle="Loading list...">
        <div className="flex h-[300px] items-center justify-center rounded-2xl border border-border bg-surface/40 backdrop-blur-xl">
          <div className="text-center">
            <span className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin inline-block" />
            <p className="mt-3 text-sm text-muted-foreground animate-pulse">Loading case selector...</p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (investigations.length < 2) {
    return (
      <AppShell title="Compare Runs" subtitle="Fewer than 2 runs">
        <div className="rounded-2xl border border-dashed border-border/80 bg-background/30 p-8 text-center max-w-xl mx-auto space-y-4">
          <GitCompare className="h-10 w-10 mx-auto text-muted-foreground opacity-60" />
          <h3 className="text-lg font-semibold">Multiple runs required</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Comparison requires at least two distinct executions. Please run a prompt query in the **Playground** with different scenarios to generate trace records.
          </p>
          <div className="pt-2">
            <Link to="/app/playground" className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 transition">
              Go to Playground
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Compare Runs" subtitle="Cross-case telemetry differences">
      
      {/* Pickers & selectors */}
      <div className="card-elevated rounded-2xl p-5 bg-surface/50">
        <div className="flex flex-wrap items-center gap-4 justify-between">
          <div className="flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-primary-foreground" />
            <span className="text-sm font-semibold">Select executions to compare:</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground block mb-1">Base Run (A)</label>
              <select
                value={runAId}
                onChange={(e) => setRunAId(e.target.value)}
                className="rounded-xl border border-border bg-background px-3 py-1.5 text-xs text-foreground outline-none transition focus:border-primary/40 w-48 truncate"
              >
                {investigations.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.id} ({inv.title})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-center pt-4 text-muted-foreground">
              <ArrowRight className="h-4 w-4" />
            </div>
            <div>
              <label className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground block mb-1">Target Run (B)</label>
              <select
                value={runBId}
                onChange={(e) => setRunBId(e.target.value)}
                className="rounded-xl border border-border bg-background px-3 py-1.5 text-xs text-foreground outline-none transition focus:border-primary/40 w-48 truncate"
              >
                {investigations.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.id} ({inv.title})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        {runAId === runBId && (
          <p className="mt-3 text-xs text-warning flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" /> Please select two different runs to see comparison details.
          </p>
        )}
      </div>

      {isReportLoading ? (
        <div className="mt-6 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="card-elevated h-32 animate-pulse-soft rounded-2xl bg-surface/40" />
            <div className="card-elevated h-32 animate-pulse-soft rounded-2xl bg-surface/40" />
          </div>
          <div className="card-elevated h-48 animate-pulse-soft rounded-2xl bg-surface/40" />
        </div>
      ) : error || !report ? (
        runAId !== runBId && (
          <div className="mt-6 flex items-center gap-3 rounded-2xl border border-destructive/20 bg-destructive/10 p-5 text-sm text-destructive">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Failed to build compare report</p>
              <p className="mt-1 opacity-90">Verify backend services can query trace logs on the selected items.</p>
            </div>
          </div>
        )
      ) : (
        <div className="mt-6 space-y-6">
          
          {/* Side by side overview cards */}
          <div className="grid gap-4 md:grid-cols-2">
            <RunCard label="Run A" run={report.run_a} accent="muted" />
            <RunCard label="Run B" run={report.run_b} accent="primary" />
          </div>

          {/* AI narrative */}
          <div className="card-elevated relative overflow-hidden rounded-2xl p-6">
            <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full" style={{ background: "radial-gradient(closest-side, oklch(0.7 0.17 300 / 0.12), transparent)" }} />
            <div className="relative">
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-primary/70 to-primary/20">
                  <Sparkles className="h-3.5 w-3.5 text-primary-foreground" />
                </span>
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">AI Detective · diff explainer</p>
              </div>
              
              <h3 className="mt-4 max-w-3xl text-xl font-semibold tracking-tight md:text-2xl text-foreground">
                {report.narrative.headline}
              </h3>
              <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-muted-foreground">
                {report.narrative.explanation}
              </p>

              <div className="mt-6 grid gap-3 md:grid-cols-3">
                <InsightCell label="Winner" value={report.metrics_diff.winner} tone={report.metrics_diff.winner === "Run B" ? "ok" : "warn"} />
                <InsightCell label="Score Delta" value={`${report.metrics_diff.score_delta > 0 ? "+" : ""}${report.metrics_diff.score_delta} pts`} tone={report.metrics_diff.score_delta > 0 ? "ok" : report.metrics_diff.score_delta < 0 ? "warn" : "ok"} />
                <InsightCell label="Primary Driver" value={report.metrics_diff.primary_reason} tone="muted" longValue />
              </div>
            </div>
          </div>

          {/* Deterministic comparison diff row */}
          <div className="card-elevated rounded-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Execution insights</p>
                <h3 className="text-lg font-semibold">Side-by-side metric delta</h3>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">A → B</span>
            </div>

            <div className="space-y-4">
              <DiffRow
                icon={Clock}
                label="Latency"
                a={`${(report.run_a.latency_ms / 1000).toFixed(1)}s`}
                b={`${(report.run_b.latency_ms / 1000).toFixed(1)}s`}
                deltaVal={report.metrics_diff.latency_diff_ms}
                aVal={report.run_a.latency_ms}
                bVal={report.run_b.latency_ms}
                worseHigher
              />
              <DiffRow
                icon={Zap}
                label="Tokens"
                a={report.run_a.tokens.toLocaleString()}
                b={report.run_b.tokens.toLocaleString()}
                deltaVal={report.metrics_diff.tokens_diff}
                aVal={report.run_a.tokens}
                bVal={report.run_b.tokens}
                worseHigher
              />
              <DiffRow
                icon={DollarSign}
                label="Cost"
                a={`$${report.run_a.cost.toFixed(4)}`}
                b={`$${report.run_b.cost.toFixed(4)}`}
                deltaVal={report.metrics_diff.cost_diff}
                aVal={report.run_a.cost}
                bVal={report.run_b.cost}
                worseHigher
              />
              <DiffRow
                icon={Waypoints}
                label="Retries"
                a={`${report.run_a.retries}`}
                b={`${report.run_b.retries}`}
                deltaVal={report.metrics_diff.retries_diff}
                aVal={report.run_a.retries}
                bVal={report.run_b.retries}
                worseHigher
              />
            </div>
          </div>

        </div>
      )}
    </AppShell>
  );
}

function RunCard({ label, run, accent }: { label: string; run: CompareResponse["run_a"]; accent: "muted" | "primary" }) {
  const borderRing = accent === "primary" ? "border-primary/45" : "border-border";
  return (
    <div className={`card-elevated rounded-2xl border ${borderRing} p-5 bg-background/50`}>
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-primary-foreground/80">{label}</p>
        <span className="font-mono text-[10px] text-muted-foreground">{run.id}</span>
      </div>
      <h4 className="mt-1 text-[13px] font-semibold text-foreground/90 truncate max-w-xs">{run.title}</h4>
      
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Cell label="Latency" value={`${(run.latency_ms / 1000).toFixed(2)}s`} />
        <Cell label="Tokens" value={run.tokens.toLocaleString()} />
        <Cell label="Cost" value={`$${run.cost.toFixed(4)}`} />
        <Cell label="Status" value={run.status.toUpperCase()} highlight={run.status !== "completed"} />
      </div>
    </div>
  );
}

function Cell({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  const color = highlight ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-background/50 px-2.5 py-2">
      <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold tracking-tight ${color}`}>{value}</p>
    </div>
  );
}

function InsightCell({ label, value, tone, longValue }: { label: string; value: string; tone: "ok" | "warn" | "muted"; longValue?: boolean }) {
  const color = tone === "ok" ? "text-success" : tone === "warn" ? "text-warning" : "text-foreground/90";
  const size = longValue ? "text-xs" : "text-[15px]";
  return (
    <div className="rounded-xl border border-border bg-background/50 px-3 py-2.5">
      <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`mt-1 font-semibold leading-relaxed tracking-tight ${color} ${size}`}>{value}</p>
    </div>
  );
}

function DiffRow({
  icon: Icon,
  label,
  a,
  b,
  deltaVal,
  aVal,
  bVal,
  worseHigher
}: {
  icon: typeof Clock;
  label: string;
  a: string;
  b: string;
  deltaVal: number;
  aVal: number;
  bVal: number;
  worseHigher?: boolean;
}) {
  const higher = bVal > aVal;
  const worse = worseHigher ? higher : !higher;
  
  const pct = aVal > 0 ? (deltaVal / aVal) * 100 : bVal > 0 ? 100 : 0;
  const tone = deltaVal === 0 ? "text-muted-foreground" : worse ? "text-warning" : "text-success";
  const TrendIcon = deltaVal === 0 ? ShieldCheck : worse ? TrendingUp : TrendingDown;
  const maxVal = Math.max(aVal, bVal, 1);

  return (
    <div className="rounded-xl border border-border bg-background/40 p-4">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium">{label}</span>
        </div>
        <span className={`inline-flex items-center gap-1 font-mono text-[11px] ${tone}`}>
          {deltaVal !== 0 && <TrendIcon className="h-3.5 w-3.5" />}
          {deltaVal === 0 ? "No change" : `${deltaVal > 0 ? "+" : ""}${pct.toFixed(0)}%`}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Bar label={a} pct={(aVal / maxVal) * 100} tone="muted" />
        <Bar label={b} pct={(bVal / maxVal) * 100} tone={deltaVal === 0 ? "muted" : worse ? "warn" : "ok"} />
      </div>
    </div>
  );
}

function Bar({ label, pct, tone }: { label: string; pct: number; tone: "muted" | "warn" | "ok" }) {
  const bg =
    tone === "warn"
      ? "from-warning/70 to-warning/30"
      : tone === "ok"
      ? "from-success/70 to-success/30"
      : "from-muted-foreground/40 to-muted-foreground/15";
  return (
    <div>
      <div className="h-1.5 overflow-hidden rounded-full bg-border/70">
        <div className={`h-full rounded-full bg-gradient-to-r ${bg}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 font-mono text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
