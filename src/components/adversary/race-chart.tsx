import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

type Runner = {
  id: string;
  name: string;
  equity: number[];
  eliminated: boolean;
  isWinner: boolean;
};

const W = 100;
const H = 46;

/**
 * Every candidate's equity, drawn on one pair of axes.
 *
 * A leaderboard reports the finish; this shows the running. Curves share a
 * single log-scaled y-axis so a strategy that doubled and one that halved are
 * the same visual distance from flat — on a linear axis the winner's late
 * compounding would flatten everything else into a line along the bottom.
 *
 * The eliminated are drawn first and faintly, the survivors over them, the
 * winner last and brightest. Draw order is the ranking.
 */
export function RaceChart({ runners, className }: { runners: Runner[]; className?: string }) {
  const [hover, setHover] = useState<string | null>(null);

  const { paths, baselineY, span } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const r of runners) {
      for (const v of r.equity) {
        // Equity is a growth multiple, so a non-positive value would have no
        // logarithm. Guard rather than let one bad series blank the chart.
        if (v <= 0) continue;
        const l = Math.log(v);
        if (l < min) min = l;
        if (l > max) max = l;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { paths: [], baselineY: H / 2, span: 1 };
    }
    // Pad so the extremes are not welded to the frame edge.
    const pad = (max - min || 1) * 0.08;
    min -= pad;
    max += pad;
    const range = max - min || 1;
    const toY = (v: number) => H - 3 - ((Math.log(v) - min) / range) * (H - 8);

    const paths = runners.map((r) => ({
      ...r,
      d: r.equity
        .map((v, i) => {
          const x = (i / Math.max(1, r.equity.length - 1)) * W;
          return `${i ? "L" : "M"}${x.toFixed(2)},${toY(Math.max(v, 1e-6)).toFixed(2)}`;
        })
        .join(" "),
      end: r.equity[r.equity.length - 1] ?? 1
    }));

    // Where a strategy that never traded would sit: the break-even line.
    return { paths, baselineY: toY(1), span: range };
  }, [runners]);

  if (!paths.length) return null;

  const ordered = [
    ...paths.filter((p) => p.eliminated && !p.isWinner),
    ...paths.filter((p) => !p.eliminated && !p.isWinner),
    ...paths.filter((p) => p.isWinner)
  ];

  const active = hover ? paths.find((p) => p.id === hover) : null;

  return (
    <div className={cn("relative", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" role="img">
        <defs>
          <linearGradient id="race-win-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(52 211 153)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="rgb(52 211 153)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0.2, 0.4, 0.6, 0.8].map((f) => (
          <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="currentColor" strokeWidth="0.15" className="text-border" />
        ))}

        {/* Break-even. Everything below this line lost money. */}
        <line
          x1="0"
          x2={W}
          y1={baselineY}
          y2={baselineY}
          stroke="currentColor"
          strokeWidth="0.3"
          strokeDasharray="1.5 1.5"
          className="text-slate-500"
        />

        {ordered.map((p) => {
          const dim = hover !== null && hover !== p.id;
          return (
            <g key={p.id}>
              {p.isWinner && (
                <path d={`${p.d} L${W},${H} L0,${H} Z`} fill="url(#race-win-fill)" stroke="none" />
              )}
              <path
                d={p.d}
                fill="none"
                vectorEffect="non-scaling-stroke"
                strokeWidth={p.isWinner ? 1.8 : hover === p.id ? 1.6 : 0.8}
                strokeLinejoin="round"
                className={cn(
                  "transition-opacity duration-200",
                  p.isWinner
                    ? "stroke-emerald-400"
                    : p.eliminated
                      ? "stroke-slate-600"
                      : "stroke-signal-soft"
                )}
                opacity={dim ? 0.15 : p.isWinner ? 1 : p.eliminated ? 0.45 : 0.75}
              />
            </g>
          );
        })}
      </svg>

      {/* Hover targets sit outside the SVG so the stroke widths stay honest. */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {paths.map((p) => (
          <button
            key={p.id}
            onMouseEnter={() => setHover(p.id)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(p.id)}
            onBlur={() => setHover(null)}
            className={cn(
              "rounded-full border px-2 py-1 text-[10px] transition-colors",
              p.isWinner
                ? "border-emerald-500/50 bg-emerald-950/30 text-emerald-300"
                : p.eliminated
                  ? "border-border text-slate-500 hover:border-slate-600"
                  : "border-signal/30 text-signal-soft hover:border-signal/60"
            )}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="mt-2 flex items-baseline justify-between font-mono text-[9px] uppercase tracking-[.12em] text-slate-600">
        <span>
          {active ? active.name : "Log scale · dashed line is break-even"}
        </span>
        <span className={cn(active && (active.end >= 1 ? "text-emerald-300" : "text-red-300"))}>
          {active ? `${active.end >= 1 ? "+" : ""}${((active.end - 1) * 100).toFixed(0)}%` : `${span.toFixed(1)} log range`}
        </span>
      </div>
    </div>
  );
}
