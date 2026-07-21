import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Play, Github, Sparkles, Zap, ShieldCheck, Waypoints } from "lucide-react";
import { Logo } from "@/components/Logo";
import { PipelineFlow } from "@/components/PipelineFlow";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setActive((i) => (i + 1) % 7), 900);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0" style={{ background: "var(--gradient-mesh)" }} />
      <div className="pointer-events-none absolute inset-0 grid-bg mask-fade-b opacity-60" />

      {/* Nav */}
      <header className="relative z-10 mx-auto flex max-w-[1200px] items-center justify-between px-6 py-6">
        <Logo />
        <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
          <a href="#product" className="hover:text-foreground transition">Product</a>
          <a href="#pipeline" className="hover:text-foreground transition">How it works</a>
          <a href="#" className="hover:text-foreground transition">Docs</a>
          <a href="#" className="hover:text-foreground transition">Pricing</a>
        </nav>
        <div className="flex items-center gap-2">
          <a href="#" className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/60 px-3 py-1.5 text-xs text-muted-foreground hover:bg-elevated">
            <Github className="h-3.5 w-3.5" /> 2.4k
          </a>
          <Link
            to="/app/investigations"
            className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 transition"
          >
            Open app
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto max-w-[1200px] px-6 pt-16 pb-24 text-center md:pt-24">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur animate-fade-in">
          <span className="grid h-4 w-4 place-items-center rounded-full bg-primary/20">
            <Sparkles className="h-2.5 w-2.5 text-primary-foreground" />
          </span>
          The Chrome DevTools for AI Agents · built on OpenTelemetry
        </div>

        <h1 className="mx-auto mt-8 max-w-4xl text-5xl font-semibold leading-[1.05] tracking-tight md:text-7xl animate-fade-in" style={{ animationDelay: "80ms" }}>
          <span className="text-gradient">AI shouldn't be</span><br />
          <span className="text-brand-gradient">a black box.</span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-balance text-base text-muted-foreground md:text-lg animate-fade-in" style={{ animationDelay: "160ms" }}>
          Open any AI request like a case file. Replay it frame-by-frame, watch every retriever, tool and validator fire, and let the AI Detective explain what happened.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3 animate-fade-in" style={{ animationDelay: "240ms" }}>
          <Link
            to="/app/investigations"
            className="group inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-foreground shadow-[0_10px_40px_-10px_oklch(0.68_0.19_275_/_0.7)] hover:opacity-95 transition"
          >
            Start investigating
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <button className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 px-5 py-3 text-sm font-medium backdrop-blur hover:bg-elevated transition">
            <Play className="h-3.5 w-3.5" />
            Watch a case
          </button>
        </div>

        {/* Trust row */}
        <div className="mx-auto mt-16 flex max-w-2xl flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[11px] font-mono uppercase tracking-[0.2em] text-muted-foreground/70 animate-fade-in" style={{ animationDelay: "320ms" }}>
          <span>OpenTelemetry</span><span>·</span>
          <span>SigNoz</span><span>·</span>
          <span>OpenAI</span><span>·</span>
          <span>Anthropic</span><span>·</span>
          <span>LangChain</span>
        </div>
      </section>

      {/* Pipeline showcase */}
      <section id="pipeline" className="relative z-10 mx-auto max-w-[1200px] px-6 pb-24">
        <div className="card-elevated relative overflow-hidden rounded-3xl p-6 md:p-10">
          <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(600px 300px at 50% 0%, oklch(0.68 0.19 275 / 0.14), transparent 60%)" }} />
          <div className="relative">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Live investigation · case #a4f9c</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">One request. Every decision, on the record.</h2>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1.5 text-[11px] text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-soft" /> replaying
              </div>
            </div>

            <div className="mt-8 rounded-2xl border border-border bg-background/40 p-5 md:p-8">
              <PipelineFlow activeIndex={active} />
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                { k: "p99 latency", v: "412 ms", d: "-18% wk" },
                { k: "spans / min", v: "12.4k", d: "steady" },
                { k: "cost / 1k", v: "$0.043", d: "-6%" },
                { k: "error rate", v: "0.21%", d: "healthy" },
              ].map((m) => (
                <div key={m.k} className="rounded-xl border border-border bg-surface/60 px-4 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{m.k}</p>
                  <p className="mt-1 text-lg font-semibold tracking-tight">{m.v}</p>
                  <p className="text-[11px] text-muted-foreground">{m.d}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="product" className="relative z-10 mx-auto max-w-[1200px] px-6 pb-32">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { icon: Waypoints, title: "Investigations", body: "Every AI request becomes a case file. Prompt, plan, retrieval, tools, validation — all on record." },
            { icon: Zap, title: "Replay", body: "Rewind execution frame-by-frame. Pause on any span. Watch the pipeline light up like DevTools." },
            { icon: ShieldCheck, title: "AI Detective", body: "Root-cause narratives with confidence scoring and one-click optimizations." },
          ].map((f) => (
            <div key={f.title} className="card-elevated group rounded-2xl p-6 transition-all hover:-translate-y-0.5">
              <span className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-elevated">
                <f.icon className="h-4 w-4 text-primary-foreground" />
              </span>
              <h3 className="mt-5 text-base font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="relative z-10 border-t border-border">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-6 py-8 text-xs text-muted-foreground">
          <Logo size={16} />
          <p>© 2026 BlackBox AI. All rights reserved.</p>
          <div className="flex items-center gap-5">
            <a href="#" className="hover:text-foreground">Docs</a>
            <a href="#" className="hover:text-foreground">Changelog</a>
            <a href="#" className="hover:text-foreground">Privacy</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
