import { useState } from "react";
import { CircleAlert, Flame } from "lucide-react";

import Layout from "@/components/Layout";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { NumberInput, Stat } from "@/components/metrics";
import { money, percent } from "@/lib/format";

export default function FomoPage() {
  const [amount, setAmount] = useState(1000);
  const [thenPrice, setThenPrice] = useState(450);
  const [nowPrice, setNowPrice] = useState(600);

  const shares = thenPrice > 0 ? amount / thenPrice : 0;
  const value = shares * nowPrice;
  const gain = value - amount;

  return (
    <Layout showBackLink>
      <section className="grid gap-6 py-9 lg:grid-cols-[.85fr_1.15fr]">
        <ScrollReveal variant="rise">
          <div className="eyebrow">
            <Flame size={15} />
            Counterfactual, not a forecast
          </div>
          <h1 className="mt-4 font-display text-5xl font-semibold leading-[1.02] tracking-[-.018em] text-foreground">
            The FOMO
            <br />
            calculator.
          </h1>
          <p className="mt-4 max-w-md text-base leading-7 text-muted-foreground">
            See the arithmetic behind “I should have bought it then”—without using it as a reason to chase it now.
          </p>
        </ScrollReveal>

        <ScrollReveal variant="settle" index={1} className="rounded-[28px] border border-border bg-card/70 p-5 md:p-7">
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberInput label="Amount you considered" value={amount} setValue={setAmount} prefix="$" />
            <NumberInput label="Price then" value={thenPrice} setValue={setThenPrice} prefix="$" />
            <NumberInput label="Price now" value={nowPrice} setValue={setNowPrice} prefix="$" />
          </div>

          <div className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
            <Stat label="Hypothetical shares" value={shares.toFixed(2)} />
            <Stat label="Value today" value={money(value)} accent />
            <Stat label="Missed change" value={percent(amount ? gain / amount : null)} accent={gain >= 0} />
          </div>

          <div className="mt-5 rounded-2xl border border-border bg-muted/60 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
              Why this matters
            </div>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-400">
              <li>• FOMO is often a hindsight trap: it turns a missed move into a reason to chase the next one.</li>
              <li>• This calculator converts that feeling into arithmetic so the risk is visible before the emotion takes over.</li>
              <li>• The numbers are useful as a reality check, not as a buy signal.</li>
            </ul>
          </div>

          <p className="mt-5 flex gap-2 text-xs leading-5 text-muted-foreground">
            <CircleAlert className="mt-0.5 shrink-0" size={14} />
            This is a past-price calculation using your inputs. It excludes tax, fees, dividends, timing risk, and says
            nothing about what to buy next.
          </p>
        </ScrollReveal>
      </section>
    </Layout>
  );
}
