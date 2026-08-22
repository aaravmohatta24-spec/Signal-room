import { useState, useEffect } from "react";
import { Sparkles, Activity, Trophy, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

import Layout from "@/components/Layout";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { ActionButton } from "@/components/ui/action-button";
import { EquityChart } from "@/components/metrics";
import { percent } from "@/lib/format";
const rupees = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value);
import { runBacktest, type BacktestResult, type CostModel } from "@/lib/adversary/engine";
import { type StrategySpec } from "@/lib/adversary/spec";
import { playbookFor } from "@/lib/adversary/playbook";
import { generateStrategies } from "@/lib/gemini";
import type { FetchedSeries, InstrumentClass } from "../../scripts/fetch-market-data";
import { type Bars, SignalCache } from "@/lib/adversary/signals";

export default function StrategyLabPage() {
  const [marketData, setMarketData] = useState<FetchedSeries[]>([]);
  const [selectedTicker, setSelectedTicker] = useState("AAPL");
  const [aiPrompt, setAiPrompt] = useState("A trend-following strategy using moving averages.");
  const [capital, setCapital] = useState(100000);
  
  const [isRacing, setIsRacing] = useState(false);
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState<{ spec: StrategySpec; result: BacktestResult }[]>([]);

  const runRace = async () => {
    setIsRacing(true);
    setResults([]);
    
    try {
      const series = marketData.find(s => s.ticker === selectedTicker) || marketData[0];
      const bars: Bars = {
        ticker: series.ticker,
        dates: series.dates,
        open: new Float64Array(series.open),
        high: new Float64Array(series.high),
        low: new Float64Array(series.low),
        close: new Float64Array(series.close),
        volume: new Float64Array(series.volume),
      };

      setProgress("Generating AI strategies via Gemini...");
      let specs: StrategySpec[] = [];
      try {
        const aiSpecs = await generateStrategies(aiPrompt, series.ticker, 3);
        specs.push(...aiSpecs);
      } catch (err) {
        console.error("Gemini generation failed, falling back to playbook.", err);
      }

      setProgress("Adding Playbook strategies...");
      const playbookSpecs = playbookFor(series.assetClass).map(p => p.build(series.ticker, series.assetClass));
      specs.push(...playbookSpecs.slice(0, 3)); // add top 3 to the race

      setProgress("Running backtest engine...");
      // Add slight delay so UI can render progress
      await new Promise(r => setTimeout(r, 100));

      const cache = new SignalCache(bars);
      const raceResults = specs.map(spec => {
        try {
          return { spec, result: runBacktest(spec, bars, { feeBps: 10, slippageBps: 5 }, cache) };
        } catch {
          return null;
        }
      }).filter(Boolean) as { spec: StrategySpec; result: BacktestResult }[];

      // Sort by Total Return
      raceResults.sort((a, b) => b.result.metrics.totalReturn - a.result.metrics.totalReturn);
      setResults(raceResults);
    } catch (error) {
      console.error(error);
      alert("Race failed: " + (error instanceof Error ? error.message : "Unknown error"));
    } finally {
      setIsRacing(false);
      setProgress("");
    }
  };

  const winner = results[0];

  return (
    <Layout showBackLink>
      <section className="py-9">
        <ScrollReveal variant="rise">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <div className="eyebrow">
                <Trophy size={15} />
                Strategy Race
              </div>
              <h1 className="mt-4 font-display text-5xl font-semibold leading-[1.02] tracking-[-.018em] text-foreground">
                May the best<br />
                strategy win.
              </h1>
            </div>
            <p className="max-w-sm text-sm leading-6 text-muted-foreground">
              Generate strategies with Gemini and race them against famous playbook setups to find the most profitable edge.
            </p>
          </div>
        </ScrollReveal>

        <div className="mt-8 grid gap-8 lg:grid-cols-[330px_1fr]">
          <ScrollReveal variant="settle" index={1}>
            <aside className="rounded-[28px] border border-border bg-card p-6">
              <div className="mb-6 font-mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">
                Race Configuration
              </div>

              <div className="space-y-5">
                <div>
                  <label className="mb-2 block text-xs font-medium text-muted-foreground">Select Asset</label>
                  <select 
                    className="w-full rounded-xl border border-border bg-muted/50 p-3 text-sm text-foreground outline-none focus:border-signal"
                    value={selectedTicker}
                    onChange={(e) => setSelectedTicker(e.target.value)}
                  >
                    {marketData.map(s => (
                      <option key={s.ticker} value={s.ticker}>{s.ticker} - {s.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-medium text-muted-foreground">Initial Capital (₹)</label>
                  <input 
                    type="number"
                    className="w-full rounded-xl border border-border bg-muted/50 p-3 text-sm text-foreground outline-none focus:border-signal"
                    value={capital}
                    onChange={(e) => setCapital(Number(e.target.value))}
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-medium text-muted-foreground">AI Strategy Prompt</label>
                  <textarea 
                    className="w-full rounded-xl border border-border bg-muted/50 p-3 text-sm text-foreground outline-none focus:border-signal min-h-[100px]"
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="Describe a strategy for Gemini to build..."
                  />
                </div>

                <ActionButton
                  onClick={runRace}
                  disabled={isRacing || !marketData.length}
                  className="w-full justify-center"
                >
                  <Sparkles size={16} />
                  {isRacing ? "Racing..." : "Generate & Race"}
                </ActionButton>
                
                {isRacing && (
                  <p className="text-center text-xs text-signal mt-2 animate-pulse">{progress}</p>
                )}
              </div>
            </aside>
          </ScrollReveal>

          <div className="min-w-0">
            {!winner ? (
              <ScrollReveal variant="settle" index={2} className="grid h-full min-h-[400px] place-items-center rounded-[28px] border border-border bg-card/50 text-center">
                <div>
                  <Activity className="mx-auto text-zinc-700" size={36} />
                  <p className="mt-4 text-sm text-muted-foreground">
                    Configure your race on the left to begin.
                  </p>
                </div>
              </ScrollReveal>
            ) : (
              <ScrollReveal variant="settle" index={2} className="space-y-8">
                {/* Winner Header */}
                <div className="rounded-[28px] border border-signal/20 bg-signal/5 p-6 md:p-8 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-10">
                    <Trophy size={120} />
                  </div>
                  <div className="relative z-10">
                    <div className="inline-flex items-center gap-2 rounded-full border border-signal/30 bg-signal/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[.1em] text-signal">
                      <Trophy size={12} /> Winner
                    </div>
                    <h2 className="mt-4 text-3xl font-semibold text-foreground">{winner.spec.name}</h2>
                    <div className="mt-6 inline-flex items-center gap-4 rounded-2xl bg-card p-4 border border-border">
                      <div className="text-xs text-muted-foreground uppercase tracking-widest">Current Signal</div>
                      <div className="flex items-center gap-2 font-bold text-lg">
                        {winner.result.stance.position === "long" ? (
                          <><ArrowUpRight className="text-green-500" /> <span className="text-green-500">BUY</span></>
                        ) : winner.result.stance.position === "short" ? (
                          <><ArrowDownRight className="text-red-500" /> <span className="text-red-500">SELL</span></>
                        ) : (
                          <><Minus className="text-zinc-500" /> <span className="text-zinc-500">FLAT</span></>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* AlgoTest Metrics Dashboard */}
                <div className="rounded-[28px] border border-border bg-card p-6 md:p-8">
                  <h3 className="font-mono text-[12px] uppercase tracking-[.14em] text-muted-foreground mb-6">
                    Performance Metrics
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    <MetricCard label="Overall Profit" value={rupees(winner.result.metrics.totalReturn * capital)} highlight={winner.result.metrics.totalReturn >= 0} />
                    <MetricCard label="No. of Trades" value={winner.result.metrics.tradeCount} />
                    <MetricCard label="Win %" value={percent(winner.result.metrics.winRate)} />
                    <MetricCard label="Loss %" value={percent(winner.result.metrics.lossRate)} />
                    <MetricCard label="Avg Profit per Trade" value={rupees((winner.result.metrics.totalReturn * capital) / (winner.result.metrics.tradeCount || 1))} />
                    <MetricCard label="Avg Profit on Win" value={rupees(winner.result.metrics.avgWin * capital)} highlight={true} />
                    <MetricCard label="Avg Loss on Loss" value={rupees(winner.result.metrics.avgLoss * capital)} highlight={false} />
                    <MetricCard label="Max Win in Single Trade" value={rupees(winner.result.metrics.maxWin * capital)} />
                    <MetricCard label="Max Loss in Single Trade" value={rupees(winner.result.metrics.maxLoss * capital)} />
                    <MetricCard label="Max Drawdown" value={rupees(winner.result.metrics.maxDrawdown * capital * -1)} highlight={false} />
                    <MetricCard label="Duration of Max DD (days)" value={winner.result.metrics.maxDrawdownDuration} />
                    <MetricCard label="Reward to Risk Ratio" value={winner.result.metrics.rewardRiskRatio.toFixed(2)} />
                    <MetricCard label="Expectancy Ratio" value={winner.result.metrics.expectancyRatio.toFixed(2)} />
                    <MetricCard label="Max Win Streak" value={winner.result.metrics.maxWinStreak} />
                    <MetricCard label="Max Losing Streak" value={winner.result.metrics.maxLossStreak} />
                    <MetricCard label="Trades in Max DD" value={winner.result.metrics.maxDrawdownTrades} />
                  </div>
                </div>

                <div className="rounded-[28px] border border-border bg-card p-6 md:p-8">
                  <h3 className="font-mono text-[12px] uppercase tracking-[.14em] text-muted-foreground mb-6">
                    Equity Curve
                  </h3>
                  <div className="h-[300px]">
                    <EquityChart equity={Array.from(winner.result.equity)} />
                  </div>
                </div>
                
                {/* Leaderboard */}
                {results.length > 1 && (
                  <div className="rounded-[28px] border border-border bg-card p-6 md:p-8">
                    <h3 className="font-mono text-[12px] uppercase tracking-[.14em] text-muted-foreground mb-6">
                      Race Leaderboard
                    </h3>
                    <div className="space-y-2">
                      {results.slice(1).map((res, i) => (
                        <div key={i} className="flex justify-between items-center p-3 rounded-xl bg-muted/30 border border-border">
                          <span className="text-sm font-medium">{res.spec.name}</span>
                          <span className="text-sm font-mono">{percent(res.result.metrics.totalReturn)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </ScrollReveal>
            )}
          </div>
        </div>
      </section>
    </Layout>
  );
}

function MetricCard({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  const isPositive = highlight === true;
  const isNegative = highlight === false;
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-muted/30 p-4">
      <span className="text-xs text-muted-foreground leading-tight">{label}</span>
      <span className={`text-lg font-medium ${isPositive ? 'text-green-500' : isNegative ? 'text-red-500' : 'text-foreground'}`}>
        {value}
      </span>
    </div>
  );
}
