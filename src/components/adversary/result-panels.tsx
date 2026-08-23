import { useMemo } from "react";

import { cn } from "@/lib/utils";

const VB = { w: 900, h: 190 };
const PAD = { top: 12, right: 68, bottom: 26, left: 10 };
const PLOT = { x0: PAD.left, x1: VB.w - PAD.right, y0: PAD.top, y1: VB.h - PAD.bottom };

/**
 * The underwater curve: how far below its own running peak the account sits,
 * every day, for the whole test.
 *
 * The equity curve answers "did this make money". This answers the question
 * that actually decides whether a rule is runnable — how long, and how deep,
 * the bad stretches were. A strategy can finish well up and still be
 * untradeable if it spent four years underwater to get there, and that is
 * invisible on an equity chart that ends at a high.
 */
export function DrawdownPanel({
  drawdown,
  dates,
  className
}: {
  drawdown: number[];
  dates: string[];
  className?: string;
}) {
  const model = useMemo(() => {
    if (drawdown.length < 2) return null;
    const step = Math.max(1, Math.floor(drawdown.length / 600));
    const idx: number[] = [];
    for (let i = 0; i < drawdown.length; i += step) idx.push(i);
    if (idx[idx.length - 1] !== drawdown.length - 1) idx.push(drawdown.length - 1);

    const values = idx.map((i) => drawdown[i]);
    const worst = Math.min(-0.01, -Math.max(...values.map(Math.abs)));
    const toY = (v: number) => PLOT.y0 + (Math.abs(v) / Math.abs(worst)) * (PLOT.y1 - PLOT.y0);
    const toX = (k: number) => PLOT.x0 + (k / Math.max(1, idx.length - 1)) * (PLOT.x1 - PLOT.x0);
    const line = values.map((v, k) => `${k ? "L" : "M"}${toX(k).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");

    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      y: PLOT.y0 + f * (PLOT.y1 - PLOT.y0),
      label: `${(worst * f * 100).toFixed(0)}%`
    }));

    return { idx, line, toX, ticks, worst };
  }, [drawdown]);

  if (!model) return null;
  const { idx, line, toX, ticks } = model;

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="w-full" role="img">
        {ticks.map((t) => (
          <g key={t.label}>
            <line x1={PLOT.x0} x2={PLOT.x1} y1={t.y} y2={t.y} stroke="currentColor" strokeWidth="1" className="text-border" />
            <text x={PLOT.x1 + 8} y={t.y + 3.5} className="fill-slate-500 font-mono" style={{ fontSize: 11 }}>
              {t.label}
            </text>
          </g>
        ))}
        <path d={`${line} L${PLOT.x1},${PLOT.y0} L${PLOT.x0},${PLOT.y0} Z`} className="fill-red-500/20" stroke="none" />
        <path d={line} fill="none" strokeWidth="1.6" className="stroke-red-400" />
        <line x1={PLOT.x0} x2={PLOT.x1} y1={PLOT.y1} y2={PLOT.y1} stroke="currentColor" strokeWidth="1" className="text-border" />
        {[0, 0.5, 1].map((f) => {
          const k = Math.round(f * (idx.length - 1));
          return (
            <text
              key={f}
              x={toX(k)}
              y={PLOT.y1 + 17}
              textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"}
              className="fill-slate-500 font-mono"
              style={{ fontSize: 11 }}
            >
              {(dates[idx[k]] ?? "").slice(0, 4)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export type MonthCell = { year: string; month: number; ret: number };

/**
 * Month-by-month returns as a grid.
 *
 * A single number for the year hides the shape of it. Twelve cells per row
 * shows whether a good year was steady or one lucky month carrying eleven
 * mediocre ones, which is the difference between a rule worth running and a
 * rule that happened to be holding during a gap up.
 */
export function MonthlyGrid({ cells, className }: { cells: MonthCell[]; className?: string }) {
  const { years, byKey, scale } = useMemo(() => {
    const years = [...new Set(cells.map((c) => c.year))].sort();
    const byKey = new Map(cells.map((c) => [`${c.year}-${c.month}`, c.ret]));
    // Scale to the largest absolute move so the colour range uses the data it
    // has rather than an arbitrary fixed band.
    const scale = Math.max(0.02, ...cells.map((c) => Math.abs(c.ret)));
    return { years, byKey, scale };
  }, [cells]);

  if (!years.length) return null;

  const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[560px] border-separate border-spacing-[2px]">
        <thead>
          <tr>
            <th className="w-12" />
            {MONTHS.map((m, i) => (
              <th key={i} className="font-mono text-[9px] font-normal uppercase text-slate-600">
                {m}
              </th>
            ))}
            <th className="w-14 font-mono text-[9px] font-normal uppercase text-slate-500">Yr</th>
          </tr>
        </thead>
        <tbody>
          {years.map((y) => {
            const row = MONTHS.map((_, m) => byKey.get(`${y}-${m}`));
            // Compound the months rather than summing them.
            const yearRet = row.reduce<number | null>(
              (acc, r) => (r == null ? acc : (acc == null ? 1 : acc + 1) * (1 + r) - 1),
              null
            );
            return (
              <tr key={y}>
                <td className="pr-1 text-right font-mono text-[10px] text-slate-500">{y}</td>
                {row.map((r, m) => {
                  const intensity = r == null ? 0 : Math.min(1, Math.abs(r) / scale);
                  return (
                    <td
                      key={m}
                      title={r == null ? `${y} — no data` : `${y}-${String(m + 1).padStart(2, "0")}: ${(r * 100).toFixed(1)}%`}
                      className="h-6 rounded-[2px] text-center font-mono text-[9px]"
                      style={{
                        background:
                          r == null
                            ? "rgb(var(--color-muted))"
                            : r >= 0
                              ? `rgb(52 211 153 / ${0.12 + intensity * 0.55})`
                              : `rgb(248 113 113 / ${0.12 + intensity * 0.55})`,
                        color: r == null ? "rgb(var(--color-muted-foreground))" : "rgb(238 238 248)"
                      }}
                    >
                      {r == null ? "" : (r * 100).toFixed(0)}
                    </td>
                  );
                })}
                <td
                  className={cn(
                    "rounded-[2px] bg-card text-center font-mono text-[10px]",
                    yearRet == null ? "text-slate-600" : yearRet >= 0 ? "text-emerald-300" : "text-red-300"
                  )}
                >
                  {yearRet == null ? "—" : `${yearRet >= 0 ? "+" : ""}${(yearRet * 100).toFixed(0)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Distribution of per-trade returns.
 *
 * Averages conceal shape. Two rules with the same average trade can be
 * completely different businesses — one grinding out small consistent wins,
 * the other losing most of the time and paying for it with rare large ones —
 * and only the histogram distinguishes them.
 */
export function TradeHistogram({ returns, className }: { returns: number[]; className?: string }) {
  const bins = useMemo(() => {
    if (!returns.length) return [];
    const lim = Math.max(0.02, ...returns.map(Math.abs));
    const COUNT = 21;
    const width = (lim * 2) / COUNT;
    const out = Array.from({ length: COUNT }, (_, i) => ({
      from: -lim + i * width,
      to: -lim + (i + 1) * width,
      n: 0
    }));
    for (const r of returns) {
      const i = Math.min(COUNT - 1, Math.max(0, Math.floor((r + lim) / width)));
      out[i].n++;
    }
    return out;
  }, [returns]);

  if (!bins.length) return null;
  const peak = Math.max(...bins.map((b) => b.n), 1);

  return (
    <div className={className}>
      <div className="flex h-28 items-end gap-[2px]">
        {bins.map((b, i) => (
          <div
            key={i}
            title={`${(b.from * 100).toFixed(1)}% to ${(b.to * 100).toFixed(1)}%: ${b.n} trade${b.n === 1 ? "" : "s"}`}
            className={cn(
              "flex-1 rounded-t-[2px] transition-opacity hover:opacity-100",
              b.to <= 0 ? "bg-red-400/70" : "bg-emerald-400/70"
            )}
            style={{ height: `${Math.max(b.n ? 4 : 0, (b.n / peak) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[9px] uppercase tracking-[.12em] text-slate-600">
        <span>{(bins[0].from * 100).toFixed(0)}%</span>
        <span>Per-trade return</span>
        <span>+{(bins[bins.length - 1].to * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}
