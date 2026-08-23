import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, ChevronRight, CircleAlert, Sparkles, Swords } from "lucide-react";

import Layout from "@/components/Layout";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { ActionButton } from "@/components/ui/action-button";
import {
  ASSET_CLASS_LABEL,
  INSTRUMENTS,
  instrumentByTicker,
  loadInstrument,
  type AssetClass
} from "@/lib/adversary/instruments";
import { buildPool, type PoolCandidate } from "@/lib/adversary/pool";
import { savePool } from "@/lib/adversary/handoff";
import { buildPermalink } from "@/lib/adversary/permalink";
import { cn } from "@/lib/utils";

const ORDER: AssetClass[] = ["index", "stock", "forex", "commodity"];
const COUNTS = [6, 10, 14, 20];

const FAMILY_LABEL: Record<string, string> = {
  trend: "Trend",
  "mean-reversion": "Mean reversion",
  momentum: "Momentum",
  breakout: "Breakout",
  volatility: "Volatility",
  generated: "Search draw"
};

const sizingText = (candidate: PoolCandidate) => {
  const s = candidate.spec.sizing;
  if (s.kind === "fixed_fraction") return `${s.pct}% of capital per position`;
  if (s.kind === "inverse_volatility") return `Sized inversely to ${s.lookback}-day volatility`;
  return "Equal weight per signal";
};

/**
 * Stage one, on its own page.
 *
 * This deliberately stops after generating. Nothing is attacked and nothing is
 * ranked here — a generated rule set is a claim, and keeping the stages apart
 * means the user decides which claims are worth the cost of testing rather
 * than being handed a winner by a pipeline they did not steer.
 */
export default function PipelinePage() {
  const navigate = useNavigate();

  const [ticker, setTicker] = useState("SPY");
  const [count, setCount] = useState(14);
  const [pool, setPool] = useState<PoolCandidate[] | null>(null);
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
      const bars = await loadInstrument(ticker);
      // Building the pool backtests every candidate once to discard rules that
      // never fire, so this is real work rather than a formatting pass.
      const built = buildPool(ticker, instrument.assetClass, count, Date.now() % 1_000_000, bars);
      if (built.length === 0) {
        setError(`No rule in the grammar trades often enough on ${instrument.label} to be worth testing.`);
        setPool(null);
      } else {
        setPool(built);
      }
    } catch {
      setError(`Could not load price data for ${ticker}.`);
    } finally {
      setLoading(false);
    }
  };

  const sendAll = () => {
    if (!pool || !instrument) return;
    const saved = savePool({
      ticker,
      assetClass: instrument.assetClass,
      instrumentLabel: instrument.label,
      createdAt: new Date().toISOString(),
      candidates: pool
    });
    if (!saved) {
      setError(
        "This browser refused to store the field, so it cannot be handed to the Adversary. " +
          "Send a single strategy with “Attack alone” instead."
      );
      return;
    }
    navigate("/adversary?race=1");
  };

  const playbookCount = pool?.filter((c) => c.origin === "playbook").length ?? 0;

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
            <span className="font-normal text-foreground/55">Get a field of candidate rules.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
            Each candidate arrives with its entry, its exits, its sizing, the premise behind it and the standard
            objection to it. Nothing here is tested — send the field to the Adversary and let the ordeals decide.
          </p>
        </ScrollReveal>

        <ScrollReveal variant="drift" className="mt-8">
          <div className="rounded-[20px] border border-border bg-card p-5">
            <div className="space-y-4">
              {grouped.map(([assetClass, list]) => (
                <div key={assetClass}>
                  <div className="font-mono text-[9px] uppercase tracking-[.14em] text-slate-600">
                    {ASSET_CLASS_LABEL[assetClass]} · {list.length}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {list.map((i) => (
                      <button
                        key={i.ticker}
                        onClick={() => {
                          setTicker(i.ticker);
                          setPool(null);
                        }}
                        title={`${i.label} — ${i.note}`}
                        className={cn(
                          "min-h-[36px] rounded-full border px-3 py-1.5 font-mono text-[11px] transition-colors",
                          ticker === i.ticker
                            ? "border-signal/60 bg-signal/10 text-foreground"
                            : "border-border text-muted-foreground hover:border-slate-600"
                        )}
                      >
                        {i.ticker}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 border-t border-border pt-4">
              <div className="font-mono text-[9px] uppercase tracking-[.14em] text-slate-600">Field size</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {COUNTS.map((n) => (
                  <button
                    key={n}
                    onClick={() => setCount(n)}
                    className={cn(
                      "min-h-[40px] rounded-full border px-4 py-2 text-xs transition-colors",
                      count === n
                        ? "border-signal/60 bg-signal/10 text-foreground"
                        : "border-border text-muted-foreground hover:border-slate-600"
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
                  ? `${instrument.label} · ${instrument.bars.toLocaleString()} bars · ${instrument.from} to ${instrument.to}`
                  : "Select an instrument."}
              </p>
              <ActionButton onClick={generate} disabled={!instrument || loading}>
                <Sparkles size={15} />
                {loading ? "Building the field…" : pool ? "Build a new field" : "Build the field"}
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

        {pool && (
          <ScrollReveal variant="drift" className="mt-10">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl font-semibold tracking-[-.018em] text-foreground">
                  {pool.length} candidates
                </h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {playbookCount} from the playbook, {pool.length - playbookCount} drawn by search. None tested yet.
                </p>
              </div>
              <ActionButton onClick={sendAll}>
                <Swords size={15} />
                Race all {pool.length} in the Adversary
              </ActionButton>
            </div>

            <div className="mt-5 space-y-3">
              {pool.map((candidate, index) => (
                <div
                  key={`${candidate.spec.name}-${index}`}
                  className="rounded-[18px] border border-border bg-card p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      <span className="font-mono text-[10px] text-signal-soft">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="text-base font-medium text-foreground">{candidate.spec.name}</span>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[.1em]",
                          candidate.origin === "playbook"
                            ? "border-signal/40 bg-signal/10 text-signal-soft"
                            : "border-border text-muted-foreground"
                        )}
                      >
                        {FAMILY_LABEL[candidate.family] ?? candidate.family}
                      </span>
                      <span className="font-mono text-[9px] uppercase tracking-[.1em] text-slate-600">
                        {candidate.spec.entry.direction} · {candidate.tradeCount} trades
                      </span>
                    </div>

                    <a
                      href={buildPermalink({ spec: candidate.spec })}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-signal/40 hover:text-signal-soft"
                    >
                      Attack alone
                      <ArrowUpRight size={13} />
                    </a>
                  </div>

                  <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <dt className="font-mono text-[9px] uppercase tracking-[.12em] text-slate-600">Rules</dt>
                      <dd className="mt-1 text-sm leading-6 text-foreground/90">{candidate.description}</dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[9px] uppercase tracking-[.12em] text-slate-600">Sizing</dt>
                      <dd className="mt-1 text-sm leading-6 text-muted-foreground">{sizingText(candidate)}</dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[9px] uppercase tracking-[.12em] text-slate-600">Premise</dt>
                      <dd className="mt-1 text-sm leading-6 text-muted-foreground">{candidate.premise}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="font-mono text-[9px] uppercase tracking-[.12em] text-amber-500/70">
                        The objection
                      </dt>
                      <dd className="mt-1 text-sm leading-6 text-amber-200/70">{candidate.caveat}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>

          </ScrollReveal>
        )}

        {!pool && !loading && (
          <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
            <ChevronRight size={15} className="text-signal-soft" />
            Choose an instrument above and build a field.
          </p>
        )}
      </section>
    </Layout>
  );
}
