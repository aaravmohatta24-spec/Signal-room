import { useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const VB = { w: 900, h: 340 };
const PAD = { top: 16, right: 86, bottom: 30, left: 10 };
const PLOT = { x0: PAD.left, x1: VB.w - PAD.right, y0: PAD.top, y1: VB.h - PAD.bottom };

/** Round a step to something a person would pick for an axis. */
function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) return [min];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const first = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = first; v <= max + step * 0.001; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

const money = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
};

/**
 * The account curve, drawn as a terminal would draw it.
 *
 * Values are shown in money rather than as a growth multiple, because this is
 * the panel a user reads after entering their own starting capital — the
 * question being answered is "what would the account have been worth", and a
 * multiple makes them do the arithmetic themselves.
 *
 * Drawdown is shaded beneath the running peak rather than plotted separately.
 * The depth of a hole is easier to judge against the high-water mark it fell
 * from than against a second axis somewhere else on the page.
 */
export function EquityPanel({
  equity,
  dates,
  capital,
  className
}: {
  equity: number[];
  dates: string[];
  capital: number;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [cursor, setCursor] = useState<number | null>(null);

  const model = useMemo(() => {
    if (equity.length < 2) return null;

    // Thin for rendering. A 5,000-bar path is thousands of segments the screen
    // cannot resolve, and it makes the crosshair hit-test needlessly heavy.
    const step = Math.max(1, Math.floor(equity.length / 600));
    const idx: number[] = [];
    for (let i = 0; i < equity.length; i += step) idx.push(i);
    if (idx[idx.length - 1] !== equity.length - 1) idx.push(equity.length - 1);

    const values = idx.map((i) => equity[i] * capital);
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    const pad = (hi - lo || Math.max(1, hi * 0.1)) * 0.08;
    lo -= pad;
    hi += pad;

    const toY = (v: number) => PLOT.y1 - ((v - lo) / (hi - lo)) * (PLOT.y1 - PLOT.y0);
    const toX = (k: number) => PLOT.x0 + (k / Math.max(1, idx.length - 1)) * (PLOT.x1 - PLOT.x0);

    const line = values.map((v, k) => `${k ? "L" : "M"}${toX(k).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");

    // Running peak, so the gap between it and the curve is the live drawdown.
    let peak = -Infinity;
    const peaks = values.map((v) => (peak = Math.max(peak, v)));
    const ddArea =
      peaks.map((v, k) => `${k ? "L" : "M"}${toX(k).toFixed(1)},${toY(v).toFixed(1)}`).join(" ") +
      " " +
      values
        .map((v, k) => `L${toX(values.length - 1 - k).toFixed(1)},${toY(values[values.length - 1 - k]).toFixed(1)}`)
        .join(" ") +
      " Z";

    return {
      idx, values, toX, toY, line, ddArea,
      ticks: niceTicks(lo, hi, 5).map((v) => ({ y: toY(v), value: v })),
      startY: toY(capital)
    };
  }, [equity, capital]);

  if (!model) return null;
  const { idx, values, toX, toY, line, ddArea, ticks, startY } = model;

  const dateTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const k = Math.round(f * (idx.length - 1));
    return { x: toX(k), label: (dates[idx[k]] ?? "").slice(0, 4) };
  });

  const track = (event: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    const vx = ((event.clientX - box.left) / box.width) * VB.w;
    if (vx < PLOT.x0 || vx > PLOT.x1) return setCursor(null);
    setCursor(Math.round(((vx - PLOT.x0) / (PLOT.x1 - PLOT.x0)) * (idx.length - 1)));
  };

  const at = cursor === null ? null : Math.min(Math.max(cursor, 0), idx.length - 1);
  const cv = at === null ? null : values[at];
  const up = (cv ?? capital) >= capital;

  return (
    <div className={cn("relative", className)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB.w} ${VB.h}`}
        className="w-full"
        role="img"
        onMouseMove={track}
        onMouseLeave={() => setCursor(null)}
      >
        <defs>
          <linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--color-signal))" stopOpacity="0.24" />
            <stop offset="100%" stopColor="rgb(var(--color-signal))" stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((t) => (
          <g key={t.value}>
            <line x1={PLOT.x0} x2={PLOT.x1} y1={t.y} y2={t.y} stroke="currentColor" strokeWidth="1" className="text-border" />
            <text x={PLOT.x1 + 8} y={t.y + 3.5} className="fill-slate-500 font-mono" style={{ fontSize: 11 }}>
              {money(t.value)}
            </text>
          </g>
        ))}

        {/* Starting capital: above this line the account is in profit. */}
        <line x1={PLOT.x0} x2={PLOT.x1} y1={startY} y2={startY} stroke="currentColor" strokeWidth="1.2" strokeDasharray="5 4" className="text-slate-400" />
        <text x={PLOT.x1 + 8} y={startY + 3.5} className="fill-slate-300 font-mono" style={{ fontSize: 11 }}>
          {money(capital)}
        </text>

        {/* Drawdown: the gap between the running peak and the curve. */}
        <path d={ddArea} className="fill-red-500/10" stroke="none" />

        <path d={`${line} L${PLOT.x1},${PLOT.y1} L${PLOT.x0},${PLOT.y1} Z`} fill="url(#eq-fill)" stroke="none" />
        <path d={line} fill="none" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" className="stroke-signal" />

        <line x1={PLOT.x1} x2={PLOT.x1} y1={PLOT.y0} y2={PLOT.y1} stroke="currentColor" strokeWidth="1" className="text-border" />
        <line x1={PLOT.x0} x2={PLOT.x1} y1={PLOT.y1} y2={PLOT.y1} stroke="currentColor" strokeWidth="1" className="text-border" />

        {dateTicks.map((t, i) => (
          <g key={`${t.label}-${i}`}>
            <line x1={t.x} x2={t.x} y1={PLOT.y1} y2={PLOT.y1 + 5} stroke="currentColor" strokeWidth="1" className="text-border" />
            <text
              x={t.x}
              y={PLOT.y1 + 19}
              textAnchor={i === 0 ? "start" : i === dateTicks.length - 1 ? "end" : "middle"}
              className="fill-slate-500 font-mono"
              style={{ fontSize: 11 }}
            >
              {t.label}
            </text>
          </g>
        ))}

        {at !== null && cv != null && (
          <g pointerEvents="none">
            <line x1={toX(at)} x2={toX(at)} y1={PLOT.y0} y2={PLOT.y1} stroke="currentColor" strokeWidth="1" strokeDasharray="4 3" className="text-slate-500" />
            <circle cx={toX(at)} cy={toY(cv)} r="4.5" className={up ? "fill-emerald-400" : "fill-red-400"} />
            <rect x={PLOT.x1 + 2} y={toY(cv) - 9} width={80} height={18} rx="3" className={up ? "fill-emerald-500" : "fill-red-500"} />
            <text x={PLOT.x1 + 42} y={toY(cv) + 4} textAnchor="middle" className="fill-white font-mono" style={{ fontSize: 11 }}>
              {money(cv)}
            </text>
            {dates[idx[at]] && (
              <>
                <rect x={toX(at) - 34} y={PLOT.y1 + 4} width={68} height={17} rx="3" className="fill-muted" />
                <text x={toX(at)} y={PLOT.y1 + 16} textAnchor="middle" className="fill-foreground font-mono" style={{ fontSize: 10 }}>
                  {dates[idx[at]]}
                </text>
              </>
            )}
          </g>
        )}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[10px] uppercase tracking-[.12em] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full bg-signal" /> Account value
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-red-500/25" /> Drawdown from peak
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-px w-3 border-t border-dashed border-slate-400" /> Starting capital
        </span>
      </div>
    </div>
  );
}
