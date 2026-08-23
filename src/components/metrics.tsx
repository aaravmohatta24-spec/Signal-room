import { useMemo, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export function NumberInput({
  label,
  value,
  setValue,
  prefix
}: {
  label: string;
  value: number;
  setValue: (value: number) => void;
  prefix?: string;
}) {
  return (
    <label className="block text-xs text-muted-foreground">
      {label}
      <div className="mt-2 flex items-center rounded-xl border border-border bg-muted px-3 focus-within:border-signal">
        <span className="font-mono text-slate-600">{prefix}</span>
        <input
          className="w-full bg-transparent px-1 py-3 font-mono text-sm text-foreground outline-none"
          type="number"
          min="0"
          value={value}
          onChange={(event) => setValue(Number(event.target.value))}
        />
      </div>
    </label>
  );
}

export function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-background p-5">
      <div className="font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">{label}</div>
      <div className={cn("mt-3 text-xl tracking-[-.04em]", accent ? "text-signal-soft" : "text-foreground")}>
        {value}
      </div>
    </div>
  );
}

export function EquityChart({ equity }: { equity: number[] }) {
  const path = useMemo(() => {
    if (!equity.length) return "";

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const value of equity) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
    const range = max - min || 1;

    return equity
      .map((value, i) => {
        const x = ((i / (equity.length - 1 || 1)) * 100).toFixed(2);
        const y = (92 - ((value - min) / range) * 80).toFixed(2);
        return `${i ? "L" : "M"}${x},${y}`;
      })
      .join(" ");
  }, [equity]);

  return (
    <div className="h-60 border-b border-border py-3">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full"
        role="img"
        aria-label="Strategy equity chart"
      >
        <path d="M0,20H100 M0,50H100 M0,80H100" stroke="var(--color-border)" strokeWidth=".4" fill="none" />
        <path d={path} stroke="var(--color-signal)" strokeWidth="1.15" vectorEffect="non-scaling-stroke" fill="none" />
      </svg>
    </div>
  );
}

export function Principle({
  icon,
  number,
  title,
  text
}: {
  icon: ReactNode;
  number: string;
  title: string;
  text: string;
}) {
  return (
    <article className="border-t border-border pt-5">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-signal-soft">{icon}</span>
        <span className="font-mono text-[10px]">{number}</span>
      </div>
      <h3 className="mt-9 text-xl tracking-[-.045em] text-foreground">{title}</h3>
      <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">{text}</p>
    </article>
  );
}
