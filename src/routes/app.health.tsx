import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, XCircle, Database, Brain, HardDrive, Sparkles, Server, AlertCircle } from "lucide-react";
import { LineChart, Line, ResponsiveContainer } from "recharts";

export const Route = createFileRoute("/app/health")({
  component: Health,
});

interface HealthMetricsResponse {
  total_cases: number;
  success_rate: number;
  avg_latency_ms: number;
  avg_retries: number;
  avg_cost: number;
  error_rate: number;
  services: {
    name: string;
    status: "healthy" | "warn" | "critical";
    uptime: string;
    latency: string;
  }[];
}

// Generate simple visual chart timeline details matching metric sizes
function generateJitterSeries(base: number, count = 30) {
  return Array.from({ length: count }, (_, i) => ({
    t: i,
    v: base + Math.sin(i / 2) * (base * 0.15) + Math.random() * (base * 0.1)
  }));
}

function Health() {
  const { data: health, isLoading, error } = useQuery<HealthMetricsResponse>({
    queryKey: ["healthMetrics"],
    queryFn: async () => {
      const res = await fetch("http://localhost:8000/api/analytics/health");
      if (!res.ok) throw new Error("Failed to fetch health metrics");
      return res.json();
    },
    refetchInterval: 8000
  });

  if (isLoading) {
    return (
      <AppShell title="AI Health" subtitle="Loading vitals...">
        <div className="flex h-[400px] items-center justify-center rounded-2xl border border-border bg-surface/40 backdrop-blur-xl">
          <div className="text-center">
            <span className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin inline-block" />
            <p className="mt-3 text-sm text-muted-foreground animate-pulse">Aggregating telemetry records...</p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (error || !health) {
    return (
      <AppShell title="AI Health" subtitle="Telemetry error">
        <div className="flex items-center gap-3 rounded-2xl border border-destructive/20 bg-destructive/10 p-5 text-sm text-destructive">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Backend connection failed</p>
            <p className="mt-1 opacity-90">Verify your local backend is running on port 8000 to fetch analytics.</p>
          </div>
        </div>
      </AppShell>
    );
  }

  const degradedServices = health.services.filter((s) => s.status !== "healthy").length;
  const statusLabel = degradedServices > 0 ? `Operational · ${degradedServices} degraded` : "All systems operational";
  const overallStatusIcon = degradedServices > 0 ? AlertTriangle : CheckCircle2;
  const overallStatusColor = degradedServices > 0 ? "text-warning" : "text-success";
  const overallStatusBg = degradedServices > 0 ? "bg-warning/15 ring-warning/30" : "bg-success/15 ring-success/30";

  return (
    <AppShell title="AI Health" subtitle="Pipeline vitals">
      
      {/* Vitals Summary Card */}
      <div className="card-elevated rounded-2xl p-6 bg-surface/50">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className={`relative grid h-11 w-11 place-items-center rounded-full ${overallStatusBg}`}>
              <overallStatusIcon className={`h-5 w-5 ${overallStatusColor}`} />
              <span className={`absolute inset-0 rounded-full ring-1 ${overallStatusBg} animate-pulse-soft`} />
            </span>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Overall Status</p>
              <h3 className="text-xl font-semibold tracking-tight">{statusLabel}</h3>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatBadge icon={CheckCircle2} label="Healthy" count={health.services.filter(s => s.status === "healthy").length} tone="ok" />
            <StatBadge icon={AlertTriangle} label="Degraded" count={health.services.filter(s => s.status === "warn").length} tone="warn" />
            <StatBadge icon={XCircle} label="Critical" count={health.services.filter(s => s.status === "critical").length} tone="err" />
          </div>
        </div>

        {/* Lightweight aggregates row */}
        <div className="mt-8 grid gap-4 grid-cols-2 md:grid-cols-5">
          <StatCell label="Total Cases" value={`${health.total_cases}`} />
          <StatCell label="Success Rate" value={`${health.success_rate.toFixed(1)}%`} tone={health.success_rate < 90 ? "warn" : "ok"} />
          <StatCell label="Avg Latency" value={`${(health.avg_latency_ms / 1000).toFixed(1)}s`} />
          <StatCell label="Avg Retries" value={`${health.avg_retries.toFixed(1)}`} tone={health.avg_retries > 0.5 ? "warn" : "muted"} />
          <StatCell label="Avg Cost" value={`$${health.avg_cost.toFixed(4)}`} />
        </div>
      </div>

      {/* Services Grid (Loaded from Telemetry Node metrics) */}
      <div className="mt-6">
        <h3 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-4">Service Pipeline Latencies</h3>
        
        {health.services.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {health.services.map((s, i) => {
              const Icon = s.name.includes("LLM") ? Brain : s.name.includes("Retriever") ? Database : s.name.includes("Weather") ? Sparkles : Server;
              const numericLatency = parseInt(s.latency) || 50;
              
              return (
                <div 
                  key={s.name} 
                  className="card-elevated group rounded-2xl p-5 transition-all hover:-translate-y-0.5 animate-fade-in" 
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-elevated">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </span>
                      <div>
                        <p className="text-sm font-medium">{s.name}</p>
                        <StatusPill status={s.status} />
                      </div>
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground">telemetry</span>
                  </div>

                  {/* Sparkline */}
                  <div className="mt-5 h-14">
                    <ResponsiveContainer>
                      <LineChart data={generateJitterSeries(numericLatency)}>
                        <Line
                          type="monotone"
                          dataKey="v"
                          stroke={s.status === "critical" ? "oklch(0.63 0.22 22)" : s.status === "warn" ? "oklch(0.78 0.15 78)" : "oklch(0.72 0.16 155)"}
                          strokeWidth={1.5}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3">
                    <div>
                      <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Uptime</p>
                      <p className="mt-0.5 text-[13px] font-semibold">{s.uptime}</p>
                    </div>
                    <div>
                      <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Avg Latency</p>
                      <p className="mt-0.5 text-[13px] font-semibold">{s.latency}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border/80 bg-background/20 p-8 text-center text-sm text-muted-foreground">
            No pipeline latency metrics found in telemetry databases. Please execute a chat run in the Playground to record telemetry events.
          </div>
        )}
      </div>
    </AppShell>
  );
}

function StatusPill({ status }: { status: "healthy" | "warn" | "critical" }) {
  const map = {
    healthy: { color: "text-success", bg: "bg-success/10 border-success/25", label: "Operational" },
    warn: { color: "text-warning", bg: "bg-warning/10 border-warning/25", label: "Degraded" },
    critical: { color: "text-destructive", bg: "bg-destructive/10 border-destructive/25", label: "Critical" },
  } as const;
  const m = map[status];
  return (
    <span className={`mt-1 inline-flex items-center gap-1 rounded-full border ${m.bg} px-2 py-0.5 font-mono text-[9px] ${m.color}`}>
      <span className="h-1 w-1 rounded-full bg-current" /> {m.label}
    </span>
  );
}

function StatBadge({ icon: Icon, label, count, tone }: { icon: any; label: string; count: number; tone: "ok" | "warn" | "err" }) {
  const color = tone === "ok" ? "text-success" : tone === "warn" ? "text-warning" : "text-destructive";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-elevated px-3 py-1 text-xs ${color}`}>
      <Icon className="h-3.5 w-3.5" /> {count} {label}
    </span>
  );
}

function StatCell({ label, value, tone = "muted" }: { label: string; value: string; tone?: "ok" | "warn" | "muted" }) {
  const color = tone === "ok" ? "text-success" : tone === "warn" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-background/40 px-3.5 py-3">
      <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold tracking-tight ${color}`}>{value}</p>
    </div>
  );
}
