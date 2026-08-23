import { SignalCache, type Bars } from "./signals";
import type { ExitRule, StrategySpec } from "./spec";
import { annualise, kurtosis, mean, sharpeRatio, skewness, stdev, TRADING_DAYS } from "./stats";

/**
 * Vectorised backtest engine (§7.3).
 *
 * Deliberately simple and deliberately honest:
 *  - signals are read on bar `t`, the order fills at the OPEN of bar `t+1`
 *  - costs and slippage are charged on every side of every trade
 *  - no position is ever opened on a bar whose signal is still in warm-up
 *
 * The `t+1` execution rule is the one that matters. Filling at the close of the
 * same bar that generated the signal is the most common way a backtest quietly
 * becomes impossible to trade.
 */
export type CostModel = {
  /** Basis points charged per side. */
  feeBps: number;
  /** Basis points of slippage per side. */
  slippageBps: number;
};

export const DEFAULT_COSTS: CostModel = { feeBps: 10, slippageBps: 5 };

export type Trade = {
  entryIndex: number;
  exitIndex: number;
  entryPrice: number;
  exitPrice: number;
  direction: 1 | -1;
  returnPct: number;
  bars: number;
  reason: ExitRule["kind"];
};

/**
 * What the rule says to do as of the most recent bar.
 *
 * This is a statement about the strategy's state, not a recommendation: it
 * reports where the rules would have you positioned today given the history
 * they were tested on. Whether that rule is worth following is exactly what the
 * attacks are for, and the UI does not show this until they have run.
 */
export type Stance = {
  position: "long" | "short" | "flat";
  /** Date the current position was opened, or the last exit if flat. */
  since: string | null;
  barsHeld: number;
  /** Open profit on the live position, as a fraction. */
  unrealised: number | null;
  /** Bars since the entry condition was last true. */
  barsSinceSignal: number | null;
  asOf: string;
};

export type BacktestResult = {
  equity: Float64Array;
  /** Per-bar strategy returns, net of costs. */
  returns: Float64Array;
  drawdown: Float64Array;
  exposure: Float64Array;
  trades: Trade[];
  metrics: Metrics;
  stance: Stance;
};

export type Metrics = {
  totalReturn: number;
  cagr: number;
  sharpe: number;
  sharpeAnnual: number;
  sortino: number;
  maxDrawdown: number;
  calmar: number;
  winRate: number;
  lossRate: number;
  avgWin: number;
  avgLoss: number;
  maxWin: number;
  maxLoss: number;
  tradeCount: number;
  timeInMarket: number;
  turnover: number;
  skew: number;
  kurt: number;
  observations: number;
  expectancy: number;
  expectancyRatio: number;
  rewardRiskRatio: number;
  maxWinStreak: number;
  maxLossStreak: number;
  maxDrawdownDuration: number;
  maxDrawdownTrades: number;
};

/**
 * Entry trigger and the condition a position is held against.
 *
 * These are the same series for `greater_than` and `less_than`, where the
 * condition is a state that persists. They are NOT the same for the crossing
 * comparators, and conflating them was a real bug: a cross is an event that is
 * true on exactly one bar, so an `opposite_signal` exit tested against the
 * trigger fired the bar after entry and every crossover strategy in the
 * playbook was measuring one-day holds. A golden cross on ten years of SPY
 * reported zero percent time in market.
 *
 * So a cross keeps its event semantics for entry and is held against the state
 * it crossed into: enter when fast crosses above slow, hold while fast is
 * above slow, exit when that stops being true.
 */
function evaluateEntry(
  spec: StrategySpec,
  cache: SignalCache,
  length: number
): { trigger: Int8Array; hold: Int8Array } {
  const left = cache.get(spec.entry.left);
  const right = "kind" in spec.entry.right ? cache.get(spec.entry.right) : null;
  const constant = "kind" in spec.entry.right ? 0 : spec.entry.right.constant;
  const trigger = new Int8Array(length);
  const hold = new Int8Array(length);

  for (let i = 1; i < length; i++) {
    const l = left[i];
    const r = right ? right[i] : constant;
    const lPrev = left[i - 1];
    const rPrev = right ? right[i - 1] : constant;

    // Warm-up: any NaN input means the signal is not yet defined.
    if (Number.isNaN(l) || Number.isNaN(r) || Number.isNaN(lPrev) || Number.isNaN(rPrev)) continue;

    let fires = false;
    let holds = false;
    switch (spec.entry.comparator) {
      case "greater_than":
        fires = holds = l > r;
        break;
      case "less_than":
        fires = holds = l < r;
        break;
      case "crosses_above":
        fires = lPrev <= rPrev && l > r;
        holds = l > r;
        break;
      case "crosses_below":
        fires = lPrev >= rPrev && l < r;
        holds = l < r;
        break;
    }
    trigger[i] = fires ? 1 : 0;
    hold[i] = holds ? 1 : 0;
  }

  return { trigger, hold };
}

function targetExposure(spec: StrategySpec, cache: SignalCache, index: number): number {
  switch (spec.sizing.kind) {
    case "fixed_fraction":
      return spec.sizing.pct / 100;
    case "equal_weight":
      return 1;
    case "inverse_volatility": {
      const vol = cache.get({ kind: "volatility", period: spec.sizing.lookback })[index];
      if (Number.isNaN(vol) || vol <= 0) return 0;
      // Target 15% annualised volatility, capped at 100% exposure.
      return Math.min(15 / vol, 1);
    }
  }
}

export function runBacktest(
  spec: StrategySpec,
  bars: Bars,
  costs: CostModel = DEFAULT_COSTS,
  cache: SignalCache = new SignalCache(bars)
): BacktestResult {
  const n = bars.close.length;
  const { trigger: signal, hold } = evaluateEntry(spec, cache, n);
  const sign: 1 | -1 = spec.entry.direction === "long" ? 1 : -1;
  const costPerSide = (costs.feeBps + costs.slippageBps) / 10_000;

  const equity = new Float64Array(n);
  const returns = new Float64Array(n);
  const drawdown = new Float64Array(n);
  const exposure = new Float64Array(n);
  const trades: Trade[] = [];

  let cash = 1;
  equity[0] = 1;

  let position = 0; // signed exposure currently held
  let entryIndex = -1;
  let entryPrice = 0;
  let peakPrice = 0;
  let troughPrice = 0;

  const stopLoss = spec.exits.find((e) => e.kind === "stop_loss");
  const takeProfit = spec.exits.find((e) => e.kind === "take_profit");
  const timeStop = spec.exits.find((e) => e.kind === "time_stop");
  const trailing = spec.exits.find((e) => e.kind === "trailing_stop");
  const usesOpposite = spec.exits.some((e) => e.kind === "opposite_signal");

  for (let i = 1; i < n; i++) {
    const prevClose = bars.close[i - 1];
    const close = bars.close[i];

    // Return earned on the position held into this bar.
    //
    // On the bar where the order actually fills, the position is opened at that
    // bar's OPEN, so it earns open→close only. Using close[i-1] as the basis
    // here would credit the overnight gap to a position that did not exist yet.
    let periodReturn = 0;
    if (position !== 0) {
      const basis = i === entryIndex ? entryPrice : prevClose;
      periodReturn = basis > 0 ? position * (close / basis - 1) : 0;
    }

    if (position !== 0) {
      const move = sign * (close / entryPrice - 1);
      peakPrice = Math.max(peakPrice, close);
      troughPrice = Math.min(troughPrice, close);

      let exitReason: ExitRule["kind"] | null = null;
      if (stopLoss && "pct" in stopLoss && move <= -stopLoss.pct / 100) exitReason = "stop_loss";
      else if (takeProfit && "pct" in takeProfit && move >= takeProfit.pct / 100) exitReason = "take_profit";
      else if (timeStop && "days" in timeStop && i - entryIndex >= timeStop.days) exitReason = "time_stop";
      else if (trailing && "pct" in trailing) {
        const reference = sign === 1 ? peakPrice : troughPrice;
        const giveBack = sign === 1 ? close / reference - 1 : reference / close - 1;
        if (giveBack <= -trailing.pct / 100) exitReason = "trailing_stop";
      }
      if (!exitReason && usesOpposite && hold[i] === 0) exitReason = "opposite_signal";

      if (exitReason) {
        periodReturn -= Math.abs(position) * costPerSide;
        trades.push({
          entryIndex,
          exitIndex: i,
          entryPrice,
          exitPrice: close,
          direction: sign,
          returnPct: move * 100,
          bars: i - entryIndex,
          reason: exitReason
        });
        position = 0;
        entryIndex = -1;
      }
    }

    // Entry decision uses the signal on this bar; the fill happens next bar,
    // so the position only starts earning from i+1 onward.
    if (position === 0 && signal[i] === 1 && i + 1 < n) {
      const size = targetExposure(spec, cache, i);
      if (size > 0) {
        position = sign * size;
        entryIndex = i + 1;
        entryPrice = bars.open[i + 1] || close;
        peakPrice = entryPrice;
        troughPrice = entryPrice;
        periodReturn -= Math.abs(position) * costPerSide;
      }
    }

    returns[i] = periodReturn;
    cash *= 1 + periodReturn;
    equity[i] = cash;
    exposure[i] = Math.abs(position);
  }

  let peak = equity[0];
  let maxDd = 0;
  for (let i = 0; i < n; i++) {
    peak = Math.max(peak, equity[i]);
    drawdown[i] = peak > 0 ? equity[i] / peak - 1 : 0;
    maxDd = Math.min(maxDd, drawdown[i]);
  }

  const returnArray = Array.from(returns.subarray(1));
  const metrics = computeMetrics(returnArray, equity, trades, exposure, Math.abs(maxDd));

  // Where the rules leave you as of the final bar.
  const lastIndex = n - 1;
  let barsSinceSignal: number | null = null;
  for (let i = lastIndex; i >= 0; i--) {
    if (signal[i] === 1) {
      barsSinceSignal = lastIndex - i;
      break;
    }
  }

  const lastTrade = trades[trades.length - 1];
  const stance: Stance =
    position !== 0
      ? {
          position: sign === 1 ? "long" : "short",
          since: bars.dates[entryIndex] ?? null,
          barsHeld: lastIndex - entryIndex,
          unrealised: entryPrice > 0 ? sign * (bars.close[lastIndex] / entryPrice - 1) : null,
          barsSinceSignal,
          asOf: bars.dates[lastIndex]
        }
      : {
          position: "flat",
          since: lastTrade ? (bars.dates[lastTrade.exitIndex] ?? null) : null,
          barsHeld: lastTrade ? lastIndex - lastTrade.exitIndex : lastIndex,
          unrealised: null,
          barsSinceSignal,
          asOf: bars.dates[lastIndex]
        };

  return { equity, returns, drawdown, exposure, trades, metrics, stance };
}

export function computeMetrics(
  returnArray: number[],
  equity: Float64Array,
  trades: Trade[],
  exposure: Float64Array,
  maxDrawdown: number
): Metrics {
  const observations = returnArray.length;
  const totalReturn = equity[equity.length - 1] / equity[0] - 1;
  const years = observations / TRADING_DAYS;
  const cagr = years > 0 && equity[equity.length - 1] > 0 ? (equity[equity.length - 1] / equity[0]) ** (1 / years) - 1 : 0;

  const sharpe = sharpeRatio(returnArray);
  const downside = returnArray.filter((r) => r < 0);
  const downsideDev = stdev(downside);
  const sortino = downsideDev === 0 ? 0 : annualise(mean(returnArray) / downsideDev);

  const wins = trades.filter((t) => t.returnPct > 0);
  const losses = trades.filter((t) => t.returnPct <= 0);

  const winRate = trades.length ? wins.length / trades.length : 0;
  const lossRate = trades.length ? losses.length / trades.length : 0;
  const avgWin = wins.length ? mean(wins.map((t) => t.returnPct)) : 0;
  const avgLoss = losses.length ? mean(losses.map((t) => t.returnPct)) : 0;
  const maxWin = wins.length ? Math.max(...wins.map(t => t.returnPct)) : 0;
  const maxLoss = losses.length ? Math.min(...losses.map(t => t.returnPct)) : 0;
  
  const expectancy = (winRate * avgWin) + (lossRate * avgLoss);
  const rewardRiskRatio = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0;
  const expectancyRatio = avgLoss !== 0 ? expectancy / Math.abs(avgLoss) : 0;

  let currentWinStreak = 0;
  let maxWinStreak = 0;
  let currentLossStreak = 0;
  let maxLossStreak = 0;
  
  for (const trade of trades) {
    if (trade.returnPct > 0) {
      currentWinStreak++;
      currentLossStreak = 0;
      maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
    } else {
      currentLossStreak++;
      currentWinStreak = 0;
      maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
    }
  }

  let peak = equity[0];
  let maxDrawdownDuration = 0;
  let currentDdDuration = 0;
  let maxDrawdownTrades = 0;
  let currentDdTrades = 0;
  
  for (let i = 0; i < equity.length; i++) {
    if (equity[i] >= peak) {
      peak = equity[i];
      currentDdDuration = 0;
      currentDdTrades = 0;
    } else {
      currentDdDuration++;
      // Increment trades if a trade exited on this bar
      const tradesExitingHere = trades.filter(t => t.exitIndex === i).length;
      currentDdTrades += tradesExitingHere;
      
      if (currentDdDuration > maxDrawdownDuration) {
        maxDrawdownDuration = currentDdDuration;
      }
      if (currentDdTrades > maxDrawdownTrades) {
        maxDrawdownTrades = currentDdTrades;
      }
    }
  }

  return {
    totalReturn,
    cagr,
    sharpe,
    sharpeAnnual: annualise(sharpe),
    sortino,
    maxDrawdown,
    calmar: maxDrawdown > 0 ? cagr / maxDrawdown : 0,
    winRate,
    lossRate,
    avgWin,
    avgLoss,
    maxWin,
    maxLoss,
    tradeCount: trades.length,
    timeInMarket: exposure.length ? Array.from(exposure).filter((e) => e > 0).length / exposure.length : 0,
    turnover: years > 0 ? trades.length / years : 0,
    skew: skewness(returnArray),
    kurt: kurtosis(returnArray),
    observations,
    expectancy,
    expectancyRatio,
    rewardRiskRatio,
    maxWinStreak,
    maxLossStreak,
    maxDrawdownDuration,
    maxDrawdownTrades,
  };
}
