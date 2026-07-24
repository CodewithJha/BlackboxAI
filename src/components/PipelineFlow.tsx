import { cn } from "@/lib/utils";
import {
  MessageSquare,
  Search,
  Database,
  Brain,
  Wrench,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export type PipelineNode = {
  label: string;
  icon: LucideIcon;
  meta?: string;
};

export const defaultPipeline: PipelineNode[] = [
  { label: "Prompt", icon: MessageSquare, meta: "input" },
  { label: "Retriever", icon: Search, meta: "top-k=6" },
  { label: "Vector DB", icon: Database, meta: "ChromaDB" },
  { label: "LLM", icon: Brain, meta: "Gemini 2.5" },
  { label: "Tools", icon: Wrench, meta: "weather API" },
  { label: "Validation", icon: ShieldCheck, meta: "Pydantic" },
  { label: "Response", icon: Sparkles, meta: "stream" },
];

export function PipelineFlow({
  nodes = defaultPipeline,
  activeIndex,
  className,
  compact = false,
}: {
  nodes?: PipelineNode[];
  activeIndex?: number;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("relative w-full", className)}>
      <div className="relative flex flex-wrap items-stretch justify-center gap-2 md:gap-3">
        {nodes.map((n, i) => {
          const Icon = n.icon;
          const isActive = activeIndex === undefined ? true : i <= activeIndex;
          const isCurrent = activeIndex === i;
          return (
            <div key={n.label} className="flex items-center">
              <div
                className={cn(
                  "group relative flex items-center gap-2.5 rounded-2xl border px-3.5 transition-all duration-500",
                  compact ? "py-2" : "py-2.5",
                  isActive
                    ? "border-primary/30 bg-primary/[0.06]"
                    : "border-border bg-surface/60",
                  isCurrent && "animate-node-glow"
                )}
                style={{ animationDelay: `${i * 120}ms` }}
              >
                <span
                  className={cn(
                    "grid h-7 w-7 place-items-center rounded-xl border transition-colors",
                    isActive
                      ? "border-primary/40 bg-primary/15 text-primary-foreground"
                      : "border-border bg-elevated text-muted-foreground"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="flex flex-col leading-tight">
                  <span className="text-[13px] font-medium">{n.label}</span>
                  {!compact && n.meta && (
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {n.meta}
                    </span>
                  )}
                </div>
                {isCurrent && (
                  <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary animate-pulse-soft" />
                )}
              </div>
              {i < nodes.length - 1 && <Connector active={isActive && (activeIndex === undefined || i < (activeIndex ?? -1))} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Connector({ active }: { active: boolean }) {
  return (
    <svg width="34" height="20" viewBox="0 0 34 20" fill="none" className="mx-0.5 shrink-0">
      <line
        x1="0"
        y1="10"
        x2="34"
        y2="10"
        stroke={active ? "oklch(0.68 0.19 275 / 0.7)" : "oklch(1 0 0 / 0.12)"}
        strokeWidth="1.25"
        strokeDasharray="4 4"
        style={active ? { animation: "flow-dash 1.2s linear infinite" } : undefined}
      />
      <path
        d="M28 5 L34 10 L28 15"
        stroke={active ? "oklch(0.68 0.19 275 / 0.9)" : "oklch(1 0 0 / 0.18)"}
        strokeWidth="1.25"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
