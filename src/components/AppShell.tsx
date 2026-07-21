import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  Search,
  Bell,
  ChevronsUpDown,
  Command as CommandIcon,
  Plus,
  ScanSearch,
  Play,
  Sparkles,
  GitCompare,
  Terminal,
  HeartPulse,
  Settings,
} from "lucide-react";
import { Logo } from "./Logo";
import { cn } from "@/lib/utils";

type NavItem = { to: string; label: string; icon: typeof ScanSearch; badge?: string };
const nav: NavItem[] = [
  { to: "/app/investigations", label: "Investigations", icon: ScanSearch },
  { to: "/app/replay", label: "Replay", icon: Play },
  { to: "/app/detective", label: "AI Detective", icon: Sparkles, badge: "New" },
  { to: "/app/compare", label: "Compare Runs", icon: GitCompare },
  { to: "/app/playground", label: "Playground", icon: Terminal },
  { to: "/app/health", label: "AI Health", icon: HeartPulse },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children, title, subtitle, actions }: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[420px]" style={{ background: "var(--gradient-soft)" }} />

      <div className="relative flex min-h-screen">
        <aside className="sticky top-0 z-30 hidden h-screen w-[248px] shrink-0 flex-col border-r border-border bg-sidebar/80 backdrop-blur-xl md:flex">
          <div className="flex h-14 items-center px-5">
            <Logo />
          </div>

          <button className="mx-3 mt-1 flex items-center justify-between rounded-xl border border-border bg-elevated/60 px-3 py-2.5 text-left transition hover:bg-elevated">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-primary/70 to-primary/30 text-[11px] font-semibold text-primary-foreground">AC</span>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium">Acme AI</p>
                <p className="truncate font-mono text-[10px] uppercase tracking-wider text-muted-foreground">prod · us-east</p>
              </div>
            </div>
            <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>

          <nav className="mt-5 flex-1 space-y-0.5 px-3">
            <p className="px-2 pb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Mission control</p>
            {nav.map((item) => {
              const Icon = item.icon;
              const active = pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to as "/app/investigations"}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-xl px-2.5 py-2 text-[13px] transition-all",
                    active
                      ? "bg-elevated text-foreground"
                      : "text-muted-foreground hover:bg-elevated/60 hover:text-foreground"
                  )}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-primary" />
                  )}
                  <Icon className={cn("h-4 w-4 transition-colors", active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")} />
                  <span className="flex-1">{item.label}</span>
                  {item.badge && (
                    <span className="rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-primary-foreground/90">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-border p-3">
            <div className="rounded-xl border border-border bg-elevated/60 p-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium">Investigator trial</p>
                <span className="font-mono text-[10px] text-muted-foreground">14d</span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-border">
                <div className="h-full w-[62%] rounded-full bg-gradient-to-r from-primary to-primary/50" />
              </div>
              <button className="mt-3 w-full rounded-lg bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground/90 transition hover:bg-primary/15">
                Upgrade plan
              </button>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/70 px-4 backdrop-blur-xl md:px-8">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="hidden md:inline">Acme AI</span>
              <span className="hidden md:inline text-border">/</span>
              <span className="text-foreground truncate max-w-[40vw]">{title ?? "Mission Control"}</span>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button className="hidden sm:flex items-center gap-2 rounded-full border border-border bg-surface/60 px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-elevated">
                <Search className="h-3.5 w-3.5" />
                <span>Investigate a request, span, model…</span>
                <span className="ml-6 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">⌘K</span>
              </button>
              <button aria-label="Command" className="sm:hidden grid h-9 w-9 place-items-center rounded-full border border-border bg-surface hover:bg-elevated">
                <CommandIcon className="h-4 w-4" />
              </button>
              <button aria-label="Incidents" className="relative grid h-9 w-9 place-items-center rounded-full border border-border bg-surface hover:bg-elevated">
                <Bell className="h-4 w-4" />
                <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary animate-pulse-soft" />
              </button>
              <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-primary/80 to-primary/40 text-[11px] font-semibold text-primary-foreground">
                JD
              </div>
            </div>
          </header>

          <div className="border-b border-border/60 px-4 py-8 md:px-8 lg:px-12">
            <div className="mx-auto flex max-w-[1400px] flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                {subtitle && <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{subtitle}</p>}
                <h1 className="mt-1 text-3xl font-semibold tracking-tight text-gradient md:text-4xl">
                  {title}
                </h1>
              </div>
              <div className="flex items-center gap-2">{actions}</div>
            </div>
          </div>

          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-8 md:px-8 lg:px-12">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

export function PageAction({ children, variant = "default", icon: Icon }: {
  children: ReactNode;
  variant?: "default" | "primary" | "ghost";
  icon?: typeof Plus;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium transition-all ring-focus",
        variant === "primary" && "bg-primary text-primary-foreground shadow-[0_0_0_1px_oklch(1_0_0/0.06)_inset,0_10px_30px_-10px_oklch(0.68_0.19_275_/_0.6)] hover:opacity-95",
        variant === "default" && "border border-border bg-surface hover:bg-elevated",
        variant === "ghost" && "text-muted-foreground hover:text-foreground"
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}
