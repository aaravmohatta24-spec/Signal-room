import { useMemo } from "react";

import type { AttackChart } from "@/lib/adversary/attacks";
import { cn } from "@/lib/utils";

/** Shared SVG frame: fixed viewBox, scaled by CSS. */
function Frame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 100 46" preserveAspectRatio="none" className={cn("h-36 w-full", className)} role="img">
      {children}
    </svg>
  );
}

const GRID = (
  <path d="M0,11.5H100 M0,23H100 M0,34.5H100" stroke="rgb(var(--color-border))" strokeWidth=".25" fill="none" />
);

/** Equity curve, used for backtests and for the noise-vs-real comparison. */
export function EquityCurve({
  series,
  className,
  stroke = "rgb(var(--color-signal))"
}: {
  series: number[];
  className?: string;
  stroke?: string;
}) {
  const path = useMemo(() => {
    if (series.length < 2) return "";
    let min = Infinity;
    let max = -Infinity;
    for (const v of series) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = max - min || 1;
    return series
      .map((v, i) => {
        const x = (i / (series.length - 1)) * 100;
        const y = 43 - ((v - min) / range) * 40;
        return `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [series]);

  return (
    <Frame className={className}>
      {GRID}
      <path d={path} stroke={stroke} strokeWidth="1.1" fill="none" vectorEffect="non-scaling-stroke" />
    </Frame>
  );
}

/** Histogram of a null distribution with the strategy marked against it. */
function Distribution({ values, marker, markerLabel }: { values: number[]; marker: number; markerLabel: string }) {
  const { bins, min, max, peak } = useMemo(() => {
    if (!values.length) return { bins: [] as number[], min: 0, max: 1, peak: 1 };
    const lo = Math.min(...values, marker);
    const hi = Math.max(...values, marker);
    const span = hi - lo || 1;
    const count = 34;
    const out = new Array(count).fill(0);
    for (const v of values) {
      const idx = Math.min(count - 1, Math.max(0, Math.floor(((v - lo) / span) * count)));
      out[idx] += 1;
    }
    return { bins: out, min: lo, max: hi, peak: Math.max(...out, 1) };
  }, [values, marker]);

  const markerX = ((marker - min) / (max - min || 1)) * 100;

  return (
    <div>
      <Frame>
        {bins.map((count, i) => {
          const height = (count / peak) * 40;
          const width = 100 / bins.length;
          return (
            <rect
              key={i}
              x={i * width + width * 0.12}
              y={43 - height}
              width={width * 0.76}
              height={Math.max(height, 0.2)}
              fill="rgb(var(--color-muted-foreground) / 0.45)"
            />
          );
        })}
        <path
          d={`M${markerX.toFixed(2)},1V43`}
          stroke="rgb(var(--color-signal))"
          strokeWidth="1.2"
          vectorEffect="non-scaling-stroke"
        />
      </Frame>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{min.toFixed(2)}</span>
        <span className="text-signal-soft">↑ {markerLabel}</span>
        <span>{max.toFixed(2)}</span>
      </div>
    </div>
  );
}

/** Line chart for parameter and cost sweeps, with the chosen point marked. */
function Curve({
  points,
  marker,
  xLabel,
  yLabel
}: {
  points: { x: number; y: number }[];
  marker?: number;
  xLabel: string;
  yLabel: string;
}) {
  const { path, zeroY, markerX } = useMemo(() => {
    if (points.length < 2) return { path: "", zeroY: 43, markerX: null as number | null };
    const ys = points.map((p) => p.y);
    const xs = points.map((p) => p.x);
    const minY = Math.min(...ys, 0);
    const maxY = Math.max(...ys, 0);
    const rangeY = maxY - minY || 1;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const rangeX = maxX - minX || 1;

    const d = points
      .map((p, i) => {
        const x = ((p.x - minX) / rangeX) * 100;
        const y = 43 - ((p.y - minY) / rangeY) * 40;
        return `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");

    return {
      path: d,
      zeroY: 43 - ((0 - minY) / rangeY) * 40,
      markerX: marker === undefined ? null : ((marker - minX) / rangeX) * 100
    };
  }, [points, marker]);

  return (
    <div>
      <Frame>
        {GRID}
        <path d={`M0,${zeroY.toFixed(2)}H100`} stroke="rgb(var(--color-border))" strokeWidth=".5" strokeDasharray="2 2" />
        <path d={path} stroke="rgb(var(--color-signal))" strokeWidth="1.1" fill="none" vectorEffect="non-scaling-stroke" />
        {markerX !== null && (
          <path
            d={`M${markerX.toFixed(2)},1V43`}
            stroke="rgb(var(--color-signal-soft))"
            strokeWidth="1"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </Frame>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{xLabel}</span>
        <span>{yLabel}</span>
      </div>
    </div>
  );
}

/** Per-year contribution bars, with the dominant year highlighted. */
function Bars({ points, highlight }: { points: { label: string; value: number }[]; highlight?: string }) {
  const peak = Math.max(...points.map((p) => Math.abs(p.value)), 1);

  return (
    <div>
      <div className="flex h-36 items-end gap-1">
        {points.map((point) => {
          const height = (Math.abs(point.value) / peak) * 100;
          const isHighlight = point.label === highlight;
          return (
            <div key={point.label} className="flex flex-1 flex-col items-center justify-end gap-1">
              <div
                className={cn(
                  "w-full rounded-sm transition-colors",
                  isHighlight ? "bg-signal" : point.value >= 0 ? "bg-muted-foreground/45" : "bg-destructive/50"
                )}
                style={{ height: `${Math.max(height, 1)}%` }}
                title={`${point.label}: ${point.value}%`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </div>
  );
}

export function AttackChartView({ chart }: { chart: AttackChart }) {
  switch (chart.kind) {
    case "distribution":
      return <Distribution values={chart.values} marker={chart.marker} markerLabel={chart.markerLabel} />;
    case "curve":
      return <Curve points={chart.points} marker={chart.marker} xLabel={chart.xLabel} yLabel={chart.yLabel} />;
    case "bars":
      return <Bars points={chart.points} highlight={chart.highlight} />;
    case "none":
      return <p className="py-10 text-center text-xs text-muted-foreground">No chart for this attack.</p>;
  }
}
