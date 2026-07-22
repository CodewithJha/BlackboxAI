import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, PageAction } from "@/components/AppShell";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Filter, Plus, CheckCircle2, AlertTriangle, XCircle, Wrench, RotateCcw, Clock, DollarSign, Sparkles } from "lucide-react";

export const Route = createFileRoute("/app/investigations")({
  component: Investigations,
});

type Status = "completed" | "degraded" | "failed";

interface DbInvestigation {
  id: string;
  title: string;
  agent_name: string;
  status: Status;
  duration_ms: number;
  cost: number;
  total_tokens: number;
  error_count: number;
  retry_count: number;
  summary: string;
  created_at: string;
}

function formatRelativeTime(dateStr: string) {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffSecs = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (diffSecs < 60) return `${Math.max(diffSecs, 1)}s ago`;
    const diffMins = Math.floor(diffSecs / 60);
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return d.toLocaleDateString();
  } catch (e) {
    return "recently";
  }
}

function Investigations() {
  const { data: dbInvestigations = [], isLoading } = useQuery<DbInvestigation[]>({
    queryKey: ["investigations"],
    queryFn: async () => {
      const res = await fetch("http://localhost:8000/api/investigations");
      if (!res.ok) throw new Error("Failed to fetch investigations");
      return res.json();
    },
    refetchInterval: 5000 // Poll every 5 seconds to keep list updated
  });

  const completedCount = dbInvestigations.filter((i) => i.status === "completed").length;
  const degradedCount = dbInvestigations.filter((i) => i.status === "degraded").length;
  const failedCount = dbInvestigations.filter((i) => i.status === "failed").length;

  return (
    <AppShell
      title="Investigations"
      subtitle="Mission Control"
      actions={
        <>
          <PageAction icon={Filter}>Filter</PageAction>
          <PageAction variant="primary" icon={Plus}>New investigation</PageAction>
        </>
      }
    >
      {/* Intro strip */}
      <div className="card-elevated relative overflow-hidden rounded-2xl p-5">
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full" style={{ background: "radial-gradient(closest-side, oklch(0.68 0.19 275 / 0.18), transparent)" }} />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Every request is a case</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight md:text-2xl">
              {isLoading ? (
                <span className="text-muted-foreground animate-pulse-soft">Loading cases...</span>
              ) : (
                `${dbInvestigations.length} cases tracked · last hour`
              )}
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">Open any case to replay it frame-by-frame or hand it to the AI Detective.</p>
          </div>
          <div className="flex items-center gap-2">
            <Chip icon={CheckCircle2} tone="ok">{completedCount} completed</Chip>
            <Chip icon={AlertTriangle} tone="warn">{degradedCount} degraded</Chip>
            <Chip icon={XCircle} tone="err">{failedCount} failed</Chip>
          </div>
        </div>
      </div>

      {/* Cases */}
      {isLoading ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="card-elevated h-[190px] animate-pulse-soft rounded-2xl bg-surface/40" />
          ))}
        </div>
      ) : dbInvestigations.length > 0 ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {dbInvestigations.map((inv, i) => (
            <Link
              key={inv.id}
              to="/app/replay"
              onClick={() => {
                localStorage.setItem("active_trace_id", inv.id);
              }}
              className="card-elevated group relative block overflow-hidden rounded-2xl p-5 transition-all hover:-translate-y-0.5 animate-fade-in"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusTag status={inv.status} />
                    <span className="font-mono text-[10px] text-muted-foreground">{inv.id}</span>
                    <span className="hidden md:inline rounded-md border border-border bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{inv.agent_name}</span>
                  </div>
                  <h3 className="mt-3 text-[15px] font-semibold leading-snug tracking-tight text-foreground/95 truncate">
                    {inv.title}
                  </h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground line-clamp-2">
                    {typeof inv.summary === "object" && inv.summary !== null
                      ? (inv.summary.response_text || JSON.stringify(inv.summary))
                      : (inv.summary || "No description summary generated.")}
                  </p>
                </div>
                <span className="mt-0.5 grid h-8 w-8 place-items-center rounded-full border border-border bg-elevated/70 opacity-70 transition group-hover:opacity-100 group-hover:bg-primary/15 group-hover:border-primary/30">
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </span>
              </div>

              <div className="mt-5 grid grid-cols-4 gap-2">
                <Fact icon={Clock} label="Duration" value={`${(inv.duration_ms / 1000).toFixed(1)}s`} />
                <Fact icon={Wrench} label="Retries" value={`${inv.retry_count}`} tone={inv.retry_count > 0 ? "warn" : "muted"} />
                <Fact icon={RotateCcw} label="Errors" value={`${inv.error_count}`} tone={inv.error_count > 0 ? "err" : "muted"} />
                <Fact icon={DollarSign} label="Cost" value={`$${(inv.cost || 0).toFixed(4)}`} />
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-border pt-3 text-[11px] font-mono text-muted-foreground">
                <span>{formatRelativeTime(inv.created_at)}</span>
                <span className="inline-flex items-center gap-1.5 text-primary-foreground/80 transition group-hover:text-foreground">
                  <Sparkles className="h-3 w-3" /> Open investigation
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="mt-8 rounded-2xl border border-dashed border-border/70 bg-background/40 p-6 text-center">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Nothing else, yet</p>
          <p className="mt-1.5 text-sm text-muted-foreground">The next AI request you make will become an investigation.</p>
        </div>
      )}

      {/* Teaser if we have data */}
      {!isLoading && dbInvestigations.length > 0 && (
        <div className="mt-8 rounded-2xl border border-dashed border-border/70 bg-background/40 p-6 text-center animate-fade-in">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">End of history</p>
          <p className="mt-1.5 text-sm text-muted-foreground">New execution requests in the Playground will automatically register here.</p>
        </div>
      )}
    </AppShell>
  );
}

function StatusTag({ status }: { status: Status }) {
  const map = {
    completed: { c: "text-success", b: "border-success/30 bg-success/10", label: "Completed" },
    degraded: { c: "text-warning", b: "border-warning/30 bg-warning/10", label: "Degraded" },
    failed: { c: "text-destructive", b: "border-destructive/30 bg-destructive/10", label: "Failed" },
  } as const;
  const m = map[status] || map["completed"];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border ${m.b} px-2 py-0.5 font-mono text-[10px] ${m.c}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" /> {m.label}
    </span>
  );
}

function Chip({ icon: Icon, children, tone }: { icon: typeof CheckCircle2; children: React.ReactNode; tone: "ok" | "warn" | "err" }) {
  const c = tone === "ok" ? "text-success" : tone === "warn" ? "text-warning" : "text-destructive";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-elevated/70 px-2.5 py-1 font-mono text-[11px] ${c}`}>
      <Icon className="h-3 w-3" /> {children}
    </span>
  );
}

function Fact({ icon: Icon, label, value, tone = "muted" }: { icon: typeof Clock; label: string; value: string; tone?: "warn" | "err" | "muted" }) {
  const c = tone === "err" ? "text-destructive" : tone === "warn" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-background/50 px-2.5 py-2">
      <p className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
        <Icon className="h-2.5 w-2.5" /> {label}
      </p>
      <p className={`mt-1 text-[13px] font-semibold tracking-tight ${c}`}>{value}</p>
    </div>
  );
}
