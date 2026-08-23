import { useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type Runner = {
  id: string;
  name: string;
  equity: number[];
  eliminated: boolean;
  isWinner: boolean;
};

/**
 * Chart geometry, in viewBox units.
 *
 * The value scale sits on the right and the date axis along the bottom, which
 * is where a trading terminal puts them. The viewBox is large and the aspect
 * ratio is preserved so axis text renders at its true proportions — an earlier
 * version stretched a 100-unit box to full width, which is fine for a bare
 * sparkline but would smear any label drawn inside it.
 */
const VB = { w: 900, h: 380 };
const PAD = { top: 16, right: 68, bottom: 30, left: 10 };
const PLOT = {
  x0: PAD.left,
  x1: VB.w - PAD.right,
  y0: PAD.top,
  y1: VB.h - PAD.bottom
};

/** Round a log-space step to something a person would choose. */
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

const growthLabel = (multiple: number) => {
  const p = (multiple - 1) * 100;
  if (Math.abs(p) >= 1000) return `${p >= 0 ? "+" : ""}${(p / 100).toFixed(1)}×`;
  return `${p >= 0 ? "+" : ""}${p.toFixed(0)}%`;
};

const yearOf = (iso: string) => (iso ? iso.slice(0, 4) : "");

/**
 * Every candidate's equity on one pair of axes.
 *
 * A leaderboard reports the finish; this shows the running. Curves share a
 * single log-scaled value axis, so a strategy that doubled and one that halved
 * sit the same distance from break-even — on a linear axis the winner's late
 * compounding flattens everything else onto the floor.
 *
 * The eliminated draw first and faintly, survivors over them, the winner last
 * and brightest. Draw order is the ranking.
 */
export function RaceChart({
  runners,
  dates,
  className
}: {
  runners: Runner[];
  dates?: string[];
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);

  const model = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    let len = 0;
    for (const r of runners) {
      if (r.equity.length > len) len = r.equity.length;
      for (const v of r.equity) {
        // Equity is a growth multiple; a non-positive value has no logarithm.
        if (v <= 0) continue;
        const l = Math.log(v);
        if (l < lo) lo = l;
        if (l > hi) hi = l;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;

    const pad = (hi - lo || 1) * 0.08;
    lo -= pad;
    hi += pad;

    const toY = (v: number) => PLOT.y1 - ((Math.log(Math.max(v, 1e-9)) - lo) / (hi - lo)) * (PLOT.y1 - PLOT.y0);
    const toX = (i: number, n: number) => PLOT.x0 + (i / Math.max(1, n - 1)) * (PLOT.x1 - PLOT.x0);

    const series = runners.map((r) => ({
      ...r,
      d: r.equity.map((v, i) => `${i ? "L" : "M"}${toX(i, r.equity.length).toFixed(1)},${toY(v).toFixed(1)}`).join(" "),
      end: r.equity[r.equity.length - 1] ?? 1
    }));

    // Ticks are chosen in log space so the gridlines land on round returns
    // rather than on evenly spaced pixels.
    const ticks = niceTicks(lo, hi, 5).map((l) => ({ y: toY(Math.exp(l)), value: Math.exp(l) }));

    return { series, ticks, toX, toY, len, baseline: toY(1) };
  }, [runners]);

  if (!model) return null;

  const { series, ticks, toX, len, baseline } = model;

  const ordered = [
    ...series.filter((p) => p.eliminated && !p.isWinner),
    ...series.filter((p) => !p.eliminated && !p.isWinner),
    ...series.filter((p) => p.isWinner)
  ];

  // Date ticks: first, last and three between, drawn under the plot.
  const dateTicks =
    dates && dates.length > 1
      ? [0, 0.25, 0.5, 0.75, 1].map((f) => {
          const i = Math.round(f * (dates.length - 1));
          return { x: toX(i, dates.length), label: yearOf(dates[i]) };
        })
      : [];

  const track = (event: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    // Map the pointer into viewBox units before turning it into an index, so
    // the crosshair stays aligned however the SVG has been scaled.
    const vx = ((event.clientX - box.left) / box.width) * VB.w;
    if (vx < PLOT.x0 || vx > PLOT.x1) return setCursor(null);
    const f = (vx - PLOT.x0) / (PLOT.x1 - PLOT.x0);
    setCursor(Math.round(f * (len - 1)));
  };

  const readout = cursor === null ? null : series.find((s) => s.id === (hover ?? ordered[ordered.length - 1]?.id));
  const cursorX = cursor === null ? null : toX(cursor, len);
  const cursorValue = readout && cursor !== null ? readout.equity[Math.min(cursor, readout.equity.length - 1)] : null;

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
          <linearGradient id="race-win-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(52 211 153)" stopOpacity="0.20" />
            <stop offset="100%" stopColor="rgb(52 211 153)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Value gridlines and the scale on the right. */}
        {ticks.map((t) => (
          <g key={t.value}>
            <line
              x1={PLOT.x0}
              x2={PLOT.x1}
              y1={t.y}
              y2={t.y}
              stroke="currentColor"
              strokeWidth="1"
              className="text-border"
            />
            <text
              x={PLOT.x1 + 8}
              y={t.y + 3.5}
              className="fill-slate-500 font-mono"
              style={{ fontSize: 11 }}
            >
              {growthLabel(t.value)}
            </text>
          </g>
        ))}

        {/* Break-even: everything under this line lost money. */}
        <line
          x1={PLOT.x0}
          x2={PLOT.x1}
          y1={baseline}
          y2={baseline}
          stroke="currentColor"
          strokeWidth="1.2"
          strokeDasharray="5 4"
          className="text-slate-500"
        />
        <text x={PLOT.x1 + 8} y={baseline + 3.5} className="fill-slate-400 font-mono" style={{ fontSize: 11 }}>
          0%
        </text>

        {/* Axis frame. */}
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

        {ordered.map((p) => {
          const dim = hover !== null && hover !== p.id;
          return (
            <g key={p.id}>
              {p.isWinner && <path d={`${p.d} L${PLOT.x1},${PLOT.y1} L${PLOT.x0},${PLOT.y1} Z`} fill="url(#race-win-fill)" stroke="none" />}
              <path
                d={p.d}
                fill="none"
                strokeWidth={p.isWinner ? 2.4 : hover === p.id ? 2.2 : 1.2}
                strokeLinejoin="round"
                strokeLinecap="round"
                className={cn(
                  "transition-opacity duration-200",
                  p.isWinner ? "stroke-emerald-400" : p.eliminated ? "stroke-slate-600" : "stroke-signal-soft"
                )}
                opacity={dim ? 0.12 : p.isWinner ? 1 : p.eliminated ? 0.4 : 0.7}
              />
            </g>
          );
        })}

        {/* Crosshair. */}
        {cursorX !== null && (
          <g pointerEvents="none">
            <line x1={cursorX} x2={cursorX} y1={PLOT.y0} y2={PLOT.y1} stroke="currentColor" strokeWidth="1" strokeDasharray="4 3" className="text-slate-500" />
            {cursorValue != null && (
              <>
                <circle cx={cursorX} cy={model.toY(cursorValue)} r="4" className="fill-signal" />
                <rect x={PLOT.x1 + 2} y={model.toY(cursorValue) - 9} width={62} height={18} rx="3" className="fill-signal" />
                <text x={PLOT.x1 + 33} y={model.toY(cursorValue) + 4} textAnchor="middle" className="fill-white font-mono" style={{ fontSize: 11 }}>
                  {growthLabel(cursorValue)}
                </text>
              </>
            )}
            {dates && dates[Math.min(cursor!, dates.length - 1)] && (
              <>
                <rect x={cursorX - 34} y={PLOT.y1 + 4} width={68} height={17} rx="3" className="fill-muted" />
                <text x={cursorX} y={PLOT.y1 + 16} textAnchor="middle" className="fill-foreground font-mono" style={{ fontSize: 10 }}>
                  {dates[Math.min(cursor!, dates.length - 1)]}
                </text>
              </>
            )}
          </g>
        )}
      </svg>

      {/* Legend. Hovering isolates one curve. */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {series.map((p) => (
          <button
            key={p.id}
            onMouseEnter={() => setHover(p.id)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(p.id)}
            onBlur={() => setHover(null)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] transition-colors",
              p.isWinner
                ? "border-emerald-500/50 bg-emerald-950/30 text-emerald-300"
                : p.eliminated
                  ? "border-border text-slate-500 hover:border-slate-600"
                  : "border-signal/30 text-signal-soft hover:border-signal/60"
            )}
          >
            <span
              className={cn(
                "h-0.5 w-3 rounded-full",
                p.isWinner ? "bg-emerald-400" : p.eliminated ? "bg-slate-600" : "bg-signal-soft"
              )}
            />
            {p.name}
            <span className="font-mono opacity-70">{growthLabel(p.end)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
