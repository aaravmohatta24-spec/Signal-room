import { useMemo, useState } from "react";
import { ArrowUpRight, ChevronRight, CircleAlert, Sparkles, Swords } from "lucide-react";

import Layout from "@/components/Layout";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { ActionButton } from "@/components/ui/action-button";
import {
  ASSET_CLASS_LABEL,
  INSTRUMENTS,
  instrumentByTicker,
  loadInstrument,
  maxLookbackFor,
  type AssetClass
} from "@/lib/adversary/instruments";
import { sampleStrategies } from "@/lib/adversary/generator";
import { buildPermalink } from "@/lib/adversary/permalink";
import { describeSpec, type StrategySpec } from "@/lib/adversary/spec";
import { cn } from "@/lib/utils";

const ORDER: AssetClass[] = ["index", "stock", "forex", "commodity"];
const COUNTS = [5, 10, 14, 20];

/**
 * Stage one on its own page.
 *
 * This deliberately stops after generating. Nothing is attacked and nothing is
 * backtested here — a generated rule set is a claim, and the point of keeping
 * the stages apart is that the user decides which claim is worth the cost of
 * testing rather than being handed a winner by a pipeline they did not steer.
 */
export default function PipelinePage() {
  const [ticker, setTicker] = useState("SPY");
  const [count, setCount] = useState(14);
  const [specs, setSpecs] = useState<StrategySpec[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const instrument = instrumentByTicker(ticker);

  const grouped = useMemo(() => {
    const map = new Map<AssetClass, typeof INSTRUMENTS>();
    for (const i of INSTRUMENTS.filter((x) => x.isReal)) {
      const list = map.get(i.assetClass) ?? [];
      list.push(i);
      map.set(i.assetClass, list);
    }
    return ORDER.filter((c) => map.has(c)).map((c) => [c, map.get(c)!] as const);
  }, []);

  const generate = async () => {
    if (!instrument || loading) return;
    setLoading(true);
    setError(null);
    try {
      // Lookbacks are capped against the series length so a generated rule
      // cannot ask for more history than the instrument actually has.
      const bars = await loadInstrument(ticker);
      setSpecs(sampleStrategies(count, ticker, Date.now() % 1_000_000, maxLookbackFor(bars.close.length)));
    } catch {
      setError(`Could not load price data for ${ticker}.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout showBackLink>
      <section className="py-9">
        <ScrollReveal variant="rise">
          <div className="eyebrow">
            <Sparkles size={15} />
            Strategy Maker
          </div>
          <h1 className="mt-4 max-w-3xl font-display text-5xl font-semibold leading-[1.02] tracking-[-.018em] text-foreground">
            Pick an instrument.
            <br />
            <span className="font-normal text-foreground/55">Get a pool of candidate rules.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
            This tool only generates. Nothing here is tested, ranked or endorsed — each rule set is a claim waiting to
            be attacked. Send the ones you care about to the Adversary.
          </p>
        </ScrollReveal>

        <ScrollReveal variant="drift" className="mt-8">
          <div className="rounded-[20px] border border-border bg-card p-5">
            <div className="space-y-4">
              {grouped.map(([assetClass, list]) => (
                <div key={assetClass}>
                  <div className="font-mono text-[9px] uppercase tracking-[.14em] text-zinc-600">
                    {ASSET_CLASS_LABEL[assetClass]}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {list.map((i) => (
                      <button
                        key={i.ticker}
                        onClick={() => {
                          setTicker(i.ticker);
                          setSpecs(null);
                        }}
                        title={i.note}
                        className={cn(
                          "min-h-[44px] rounded-full border px-4 py-2 text-xs transition-colors",
                          ticker === i.ticker
                            ? "border-signal/60 bg-signal/10 text-foreground"
                            : "border-border text-muted-foreground hover:border-zinc-600"
                        )}
                      >
                        {i.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 border-t border-border pt-4">
              <div className="font-mono text-[9px] uppercase tracking-[.14em] text-zinc-600">How many</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {COUNTS.map((n) => (
                  <button
                    key={n}
                    onClick={() => setCount(n)}
                    className={cn(
                      "min-h-[44px] rounded-full border px-4 py-2 text-xs transition-colors",
                      count === n
                        ? "border-signal/60 bg-signal/10 text-foreground"
                        : "border-border text-muted-foreground hover:border-zinc-600"
                    )}
                  >
                    {n} strategies
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
              <p className="text-xs leading-5 text-muted-foreground">
                {instrument
                  ? `${instrument.label} · ${instrument.bars.toLocaleString()} daily bars · ${instrument.source}`
                  : "Select an instrument."}
              </p>
              <ActionButton onClick={generate} disabled={!instrument || loading}>
                <Sparkles size={15} />
                {loading ? "Loading price data…" : specs ? "Generate a new pool" : "Generate strategies"}
              </ActionButton>
            </div>
            {error && (
              <p className="mt-4 flex gap-2 text-sm text-red-300">
                <CircleAlert size={15} className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}
          </div>
        </ScrollReveal>

        {specs && (
          <ScrollReveal variant="drift" className="mt-10">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-display text-2xl font-semibold tracking-[-.018em] text-foreground">
                {specs.length} candidates
              </h2>
              <span className="font-mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">
                Untested
              </span>
            </div>

            <div className="mt-4 space-y-2">
              {specs.map((spec, index) => (
                <div key={`${spec.name}-${index}`} className="rounded-[16px] border border-border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-signal-soft">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="text-sm font-medium text-foreground">{spec.name}</span>
                        <span className="font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground">
                          {spec.entry.direction}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{describeSpec(spec)}</p>
                    </div>

                    <a
                      href={buildPermalink({ spec })}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-signal/40 hover:text-signal-soft"
                    >
                      <Swords size={13} />
                      Attack this
                      <ArrowUpRight size={13} />
                    </a>
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-5 flex gap-2 text-xs leading-5 text-muted-foreground">
              <ChevronRight size={14} className="mt-0.5 shrink-0 text-signal-soft" />
              These were sampled at random from the rule grammar. A good-looking rule here means nothing yet — that is
              what the Adversary is for.
            </p>
          </ScrollReveal>
        )}

        {!specs && (
          <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
            <ChevronRight size={15} className="text-signal-soft" />
            Choose an instrument above and generate a pool.
          </p>
        )}
      </section>
    </Layout>
  );
}
