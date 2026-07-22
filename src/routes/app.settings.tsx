import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useQuery } from "@tanstack/react-query";
import { Key, Database, Cpu, Cable, AlertCircle, CheckCircle2, Server, HelpCircle } from "lucide-react";

export const Route = createFileRoute("/app/settings")({
  component: SettingsDiagnostics,
});

interface DiagnosticsResponse {
  gemini_model: string;
  prompt_version: string;
  gemini_api_key_configured: boolean;
  database_type: string;
  opentelemetry_status: string;
  otlp_endpoint: string;
  otlp_endpoint_reachable: boolean;
}

function SettingsDiagnostics() {
  const { data: diagnostics, isLoading, error } = useQuery<DiagnosticsResponse>({
    queryKey: ["settingsDiagnostics"],
    queryFn: async () => {
      const res = await fetch("http://localhost:8000/api/settings/diagnostics");
      if (!res.ok) throw new Error("Failed to load settings diagnostics");
      return res.json();
    },
    refetchInterval: 8000 // Poll connection reachability every 8s
  });

  return (
    <AppShell title="System Diagnostics" subtitle="Read-only environment status configuration">
      <div className="space-y-6">
        
        {/* Intro Banner */}
        <div className="card-elevated relative overflow-hidden rounded-2xl p-5 bg-elevated/40">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Diagnostics Mode</p>
          <h3 className="mt-1 text-lg font-semibold">Active Engine Environment</h3>
          <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
            This dashboard displays the active environment variables, telemetry connections, and AI pipeline status. For security reasons, changes to environment variables must be made directly in configuration files rather than the web UI.
          </p>
        </div>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="card-elevated h-28 animate-pulse-soft rounded-2xl bg-surface/50" />
            ))}
          </div>
        ) : error || !diagnostics ? (
          <div className="flex items-center gap-3 rounded-2xl border border-destructive/20 bg-destructive/10 p-5 text-sm text-destructive">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Backend diagnostics unavailable</p>
              <p className="mt-1 opacity-90">Please ensure your local FastAPI backend server is running on port 8000.</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            
            {/* AI Model Config */}
            <div className="card-elevated rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10 border border-primary/20">
                  <Cpu className="h-4 w-4 text-primary-foreground/90" />
                </span>
                <div>
                  <h4 className="text-sm font-semibold">Gemini LLM Config</h4>
                  <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Model & prompt parameters</p>
                </div>
              </div>
              <div className="space-y-2 pt-2">
                <DiagnosticRow label="Active Model" value={diagnostics.gemini_model} />
                <DiagnosticRow label="Prompt Version" value={diagnostics.prompt_version} />
              </div>
            </div>

            {/* API Credentials */}
            <div className="card-elevated rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10 border border-primary/20">
                  <Key className="h-4 w-4 text-primary-foreground/90" />
                </span>
                <div>
                  <h4 className="text-sm font-semibold">API Credentials</h4>
                  <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Gemini API status</p>
                </div>
              </div>
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between text-sm py-1">
                  <span className="text-muted-foreground">API Key Config</span>
                  {diagnostics.gemini_api_key_configured ? (
                    <span className="inline-flex items-center gap-1 text-success text-xs font-medium font-mono">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Present (Active)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-warning text-xs font-medium font-mono">
                      <AlertCircle className="h-3.5 w-3.5" /> Missing (Fallback mode)
                    </span>
                  )}
                </div>
                <DiagnosticRow label="Access Scope" value="Read-only analysis" />
              </div>
            </div>

            {/* Database Engine */}
            <div className="card-elevated rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10 border border-primary/20">
                  <Database className="h-4 w-4 text-primary-foreground/90" />
                </span>
                <div>
                  <h4 className="text-sm font-semibold">Database Store</h4>
                  <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Dynamic connection type</p>
                </div>
              </div>
              <div className="space-y-2 pt-2">
                <DiagnosticRow label="Active Driver" value={diagnostics.database_type} />
                <DiagnosticRow label="Storage File" value={diagnostics.database_type === "SQLite" ? "blackbox.db" : "Remote Pool"} />
              </div>
            </div>

            {/* OpenTelemetry telemetry */}
            <div className="card-elevated rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10 border border-primary/20">
                  <Cable className="h-4 w-4 text-primary-foreground/90" />
                </span>
                <div>
                  <h4 className="text-sm font-semibold">OTel Telemetry</h4>
                  <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">OpenTelemetry Collector</p>
                </div>
              </div>
              <div className="space-y-2 pt-2">
                <DiagnosticRow label="Tracer Status" value={diagnostics.opentelemetry_status} />
                <div className="flex items-center justify-between text-sm py-1">
                  <span className="text-muted-foreground">OTLP Endpoint</span>
                  <span className="font-mono text-xs text-foreground/90">{diagnostics.otlp_endpoint}</span>
                </div>
                <div className="flex items-center justify-between text-sm py-1 border-t border-border/40 pt-2">
                  <span className="text-muted-foreground">OTLP Reachable</span>
                  {diagnostics.otlp_endpoint_reachable ? (
                    <span className="inline-flex items-center gap-1 text-success text-xs font-medium font-mono">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Listening (Port OK)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-warning text-xs font-medium font-mono">
                      <AlertCircle className="h-3.5 w-3.5" /> Offline (Refused)
                    </span>
                  )}
                </div>
              </div>
            </div>

          </div>
        )}

        {/* Local Environment Instruction */}
        <div className="card-elevated rounded-2xl p-5 border border-border/80 bg-background/50">
          <div className="flex items-start gap-3">
            <Server className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-foreground/90">How to modify these configurations</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                To update Gemini API keys, target models, or telemetry span processors, open the local configuration file:
              </p>
              <p className="mt-2 font-mono text-[11px] text-primary-foreground/90 select-all">
                /Users/priyanshujha/Downloads/BlackBox AI/backend/.env
              </p>
            </div>
          </div>
        </div>

      </div>
    </AppShell>
  );
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm py-1 border-b border-border/20 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs text-foreground/90">{value}</span>
    </div>
  );
}
