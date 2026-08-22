/// <reference lib="webworker" />
import { matchedRandomWalk } from "./data";
import { loadInstrument, maxLookbackFor } from "./instruments";
import { DEFAULT_COSTS, runBacktest } from "./engine";
import { sampleStrategies } from "./generator";
import { SignalCache, type Bars } from "./signals";
import type { StrategySpec } from "./spec";
import { annualise } from "./stats";

/**
 * The 1,000-strategy sweep runs here rather than on the main thread. It is the
 * only heavy operation in the product, and the progress it streams back is not
 * just a courtesy — watching the search run is what makes the point land.
 */
export type SweepRequest = {
  type: "sweep";
  ticker: string;
  count: number;
  seed: number;
  /** Run the same search against a zero-drift random walk as a control. */
  includeNoiseControl: boolean;
};

export type SweepProgress = {
  type: "progress";
  done: number;
  total: number;
  arm: "real" | "noise";
};

export type SweepArmResult = {
  arm: "real" | "noise";
  /** Per-observation Sharpe of every strategy tried. */
  sharpes: number[];
  best: { spec: StrategySpec; sharpeAnnual: number; equity: number[]; totalReturn: number };
};

export type SweepComplete = {
  type: "complete";
  arms: SweepArmResult[];
};

export type SweepMessage = SweepProgress | SweepComplete | { type: "error"; message: string };

/** Downsample an equity curve for transport and plotting. */
function thin(equity: Float64Array, points = 320): number[] {
  const step = Math.max(1, Math.floor(equity.length / points));
  const out: number[] = [];
  for (let i = 0; i < equity.length; i += step) out.push(equity[i]);
  return out;
}

function sweepArm(
  bars: Bars,
  arm: "real" | "noise",
  count: number,
  seed: number,
  post: (message: SweepMessage) => void
): SweepArmResult {
  const cache = new SignalCache(bars);
  const specs = sampleStrategies(count, bars.ticker, seed, maxLookbackFor(bars.close.length));

  const sharpes: number[] = [];
  let best: SweepArmResult["best"] | null = null;
  let bestSharpe = -Infinity;

  for (const [i, spec] of specs.entries()) {
    const result = runBacktest(spec, bars, DEFAULT_COSTS, cache);
    // Strategies that never trade carry no information about the search space.
    if (result.metrics.tradeCount > 0) {
      sharpes.push(result.metrics.sharpe);
      if (result.metrics.sharpe > bestSharpe) {
        bestSharpe = result.metrics.sharpe;
        best = {
          spec,
          sharpeAnnual: annualise(result.metrics.sharpe),
          equity: thin(result.equity),
          totalReturn: result.metrics.totalReturn
        };
      }
    }

    if (i % 25 === 0) post({ type: "progress", done: i, total: count, arm });
  }

  post({ type: "progress", done: count, total: count, arm });

  return {
    arm,
    sharpes,
    best: best ?? {
      spec: specs[0],
      sharpeAnnual: 0,
      equity: [1],
      totalReturn: 0
    }
  };
}

self.onmessage = (event: MessageEvent<SweepRequest>) => {
  const post = (message: SweepMessage) => self.postMessage(message);

  try {
    const { ticker, count, seed, includeNoiseControl } = event.data;
    const real = loadInstrument(ticker);

    const arms: SweepArmResult[] = [sweepArm(real, "real", count, seed, post)];

    if (includeNoiseControl) {
      // Same search, same size, against data with nothing to find.
      const noise = matchedRandomWalk(real, seed + 104_729);
      arms.push(sweepArm(noise, "noise", count, seed + 1, post));
    }

    post({ type: "complete", arms });
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : "Sweep failed." });
  }
};
