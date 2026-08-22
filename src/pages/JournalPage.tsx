import { BookOpen, ChevronRight } from "lucide-react";
import Layout from "@/components/Layout";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { SignalLine } from "@/components/ui/signal-line";

export default function JournalPage() {
  return (
    <Layout showBackLink>
      <section className="py-9">
        <ScrollReveal variant="rise">
          <div className="eyebrow">
            <BookOpen size={15} />
            How to Use the Signal Room
          </div>
          <h1 className="mt-4 font-display text-5xl font-semibold leading-[1.02] tracking-[-.018em] text-foreground">
            Three stages to
            <br />
            validate strategies.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            Pick an instrument. Generate candidates. Stress-test them. Validate the survivor. No journal entries, just data.
          </p>
        </ScrollReveal>

        <SignalLine className="mt-6" />

        {/* Stage 1 */}
        <ScrollReveal variant="drift" className="mt-10">
          <div className="space-y-4">
            <div>
              <h2 className="font-display text-2xl font-semibold tracking-[-.018em] text-foreground">
                Stage 1: Strategy Maker
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground max-w-2xl">
                Select any asset (index, stock, forex, commodity). The Signal Room generates 14 distinct strategies automatically. Each uses different entry/exit logic and sizing rules.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card/50 p-4 space-y-2">
              <p className="text-sm"><span className="font-mono text-signal-soft">1.</span> Pick an instrument from the grouped buttons</p>
              <p className="text-sm"><span className="font-mono text-signal-soft">2.</span> Review instrument metadata (bars, source)</p>
              <p className="text-sm"><span className="font-mono text-signal-soft">3.</span> Click "Run the pipeline"</p>
              <p className="text-sm"><span className="font-mono text-signal-soft">4.</span> Wait for completion (Stage 1 generates 14 candidates)</p>
            </div>
          </div>
        </ScrollReveal>

        {/* Stage 2 */}
        <ScrollReveal variant="drift" className="mt-8">
          <div className="space-y-4">
            <div>
              <h2 className="font-display text-2xl font-semibold tracking-[-.018em] text-foreground">
                Stage 2: The Adversary
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground max-w-2xl">
                Each candidate faces 8 stress tests: slippage, drawdown, regime shifts, sample size, and more. Strategies that fail are eliminated. One survivor advances to validation.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card/50 p-4 space-y-2">
              <p className="text-sm"><span className="font-mono text-signal-soft">1.</span> Review all candidates (checkmark = survived, skull = eliminated)</p>
              <p className="text-sm"><span className="font-mono text-signal-soft">2.</span> Look for the green "Survivor" badge</p>
              <p className="text-sm"><span className="font-mono text-signal-soft">3.</span> Check Sharpe ratio (higher = better risk-adjusted return)</p>
              <p className="text-sm"><span className="font-mono text-signal-soft">4.</span> Study ordeal badges (green pass, red fail)</p>
            </div>
          </div>
        </ScrollReveal>

        {/* Stage 3 */}
        <ScrollReveal variant="drift" className="mt-8">
          <div className="space-y-4">
            <div>
              <h2 className="font-display text-2xl font-semibold tracking-[-.018em] text-foreground">
                Stage 3: Back Tester
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground max-w-2xl">
                The survivor runs over 10 years of historical data. Get exact rules, metrics, and an implementation guide. Study the equity curve. Understand the risk.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card/50 p-4 space-y-2">
              <p className="text-sm"><span className="font-mono text-signal-soft">1.</span> Review the equity curve (green line showing 10-year growth)</p>
              <p className="text-sm"><span className="font-mono text-signal-soft">2.</span> Read "How to run this": Instrument, Entry, Exit, Sizing, Execution, Expected behavior</p>
              <p className="text-sm"><span className="font-mono text-signal-soft">3.</span> Check key metrics: Total return, CAGR, Sharpe, Max drawdown</p>
              <p className="text-sm"><span className="font-mono text-signal-soft">4.</span> Paper-trade for 1–3 months before risking capital</p>
            </div>
          </div>
        </ScrollReveal>

        {/* Key Concepts */}
        <ScrollReveal variant="drift" className="mt-10">
          <h2 className="font-display text-2xl font-semibold tracking-[-.018em] text-foreground mb-4">
            Key Metrics to Understand
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-card/50 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[.1em] text-signal-soft">Sharpe Ratio</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Risk-adjusted return. &lt;0.5 poor, 0.5–1.0 fair, 1.0–2.0 good, &gt;2.0 excellent.</p>
            </div>
            <div className="rounded-lg border border-border bg-card/50 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[.1em] text-signal-soft">Max Drawdown</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Worst peak-to-trough loss. Can you psychologically handle this % drop?</p>
            </div>
            <div className="rounded-lg border border-border bg-card/50 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[.1em] text-signal-soft">CAGR</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Annualized return. Example: 10-year +240% total = ~12.5% CAGR/year.</p>
            </div>
            <div className="rounded-lg border border-border bg-card/50 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[.1em] text-signal-soft">Win Rate</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">% of profitable trades. High win rate ≠ high returns; one big loss can dominate.</p>
            </div>
          </div>
        </ScrollReveal>

        {/* Best Practices */}
        <ScrollReveal variant="drift" className="mt-10">
          <h2 className="font-display text-2xl font-semibold tracking-[-.018em] text-foreground mb-4">
            Best Practices
          </h2>
          <ul className="space-y-3">
            <li className="flex gap-3">
              <ChevronRight size={16} className="text-signal-soft shrink-0 mt-0.5" />
              <span className="text-sm text-muted-foreground">Test multiple instruments—different assets generate different winners</span>
            </li>
            <li className="flex gap-3">
              <ChevronRight size={16} className="text-signal-soft shrink-0 mt-0.5" />
              <span className="text-sm text-muted-foreground">Study the equity curve during different market regimes</span>
            </li>
            <li className="flex gap-3">
              <ChevronRight size={16} className="text-signal-soft shrink-0 mt-0.5" />
              <span className="text-sm text-muted-foreground">Always paper-trade first—past performance ≠ future results</span>
            </li>
            <li className="flex gap-3">
              <ChevronRight size={16} className="text-signal-soft shrink-0 mt-0.5" />
              <span className="text-sm text-muted-foreground">Copy the implementation rules exactly; don't modify without reason</span>
            </li>
            <li className="flex gap-3">
              <ChevronRight size={16} className="text-signal-soft shrink-0 mt-0.5" />
              <span className="text-sm text-muted-foreground">Nothing survived? Run again for fresh candidates or try another asset</span>
            </li>
          </ul>
        </ScrollReveal>
      </section>
    </Layout>
  );
}
