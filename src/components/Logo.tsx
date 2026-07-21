import { cn } from "@/lib/utils";

export function Logo({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <defs>
          <linearGradient id="bb-g" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
            <stop stopColor="oklch(0.85 0.12 275)" />
            <stop offset="1" stopColor="oklch(0.7 0.17 300)" />
          </linearGradient>
        </defs>
        {/* Cube — a black box you can see through */}
        <path
          d="M12 2.5 L20.5 7 V17 L12 21.5 L3.5 17 V7 Z"
          stroke="url(#bb-g)"
          strokeWidth="1.5"
          fill="oklch(0.68 0.19 275 / 0.10)"
          strokeLinejoin="round"
        />
        <path
          d="M3.5 7 L12 11.5 L20.5 7 M12 11.5 V21.5"
          stroke="url(#bb-g)"
          strokeWidth="1.2"
          strokeLinejoin="round"
          opacity="0.85"
        />
        <circle cx="12" cy="11.5" r="1.6" fill="url(#bb-g)" />
      </svg>
      <span className="font-semibold tracking-tight">
        BlackBox <span className="text-muted-foreground font-normal">AI</span>
      </span>
    </div>
  );
}
