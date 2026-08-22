import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import Layout from "@/components/Layout";
import { HeroPanel } from "@/components/ui/hero-dithering-card";
// FlowButton is reserved for the hero call to action. Its sliding arrows are
// positioned proportionally and its fill is a fixed-size circle, so it only
// holds together at its natural width — everything else uses ActionButton.
import { FlowButton } from "@/components/ui/flow-button";
import { ActionButton } from "@/components/ui/action-button";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { OFFERINGS, type Offering } from "@/lib/offerings";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * One offering, laid out as an editorial row rather than a card in a grid.
 * Rows alternate which side the prose sits on, so the section reads as a
 * sequence of entries instead of three interchangeable tiles.
 */
function OfferingRow({ offering, index }: { offering: Offering; index: number }) {
  const flipped = index % 2 === 1;

  return (
    <ScrollReveal variant={flipped ? "drift-right" : "drift"} index={index}>
      <Link
        to={offering.path}
        className="group relative block border-t border-border py-10 transition-colors duration-500 hover:border-signal/40 md:py-14"
      >
        {/* Oversized index numeral, sitting behind the row as a watermark. */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-6 select-none font-display text-[6rem] leading-none text-foreground/[0.045] transition-all duration-700 group-hover:text-signal/20 md:text-[9rem]",
            flipped ? "right-0 group-hover:-translate-x-2" : "left-0 group-hover:translate-x-2"
          )}
        >
          {String(index + 1).padStart(2, "0")}
        </span>

        <div className="relative grid gap-x-12 gap-y-7 md:grid-cols-12">
          <div className={cn("md:col-span-6", flipped ? "md:order-2 md:col-start-7" : "md:col-start-1")}>
            <div className="flex items-center gap-3">
              <offering.icon
                className="text-signal-soft transition-transform duration-500 group-hover:-translate-y-0.5"
                size={20}
              />
              <span className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
                {offering.tagline}
              </span>
            </div>

            <h3 className="mt-4 font-display text-4xl font-semibold tracking-[-.018em] text-foreground md:text-5xl">
              {offering.name}
            </h3>

            {/* Rule that extends under the title on hover. */}
            <span className="mt-4 block h-px w-14 origin-left bg-signal/60 transition-transform duration-500 ease-out group-hover:scale-x-[4]" />

            <p className="mt-5 max-w-md text-[15px] leading-7 text-muted-foreground">{offering.summary}</p>

            <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-foreground/80 transition-colors duration-300 group-hover:text-signal-soft">
              Open {offering.name.toLowerCase()}
              <ArrowUpRight
                size={16}
                className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
              />
            </span>
          </div>

          <ul
            className={cn("self-center md:col-span-5", flipped ? "md:order-1 md:col-start-1" : "md:col-start-8")}
          >
            {offering.capabilities.map((capability, capabilityIndex) => (
              <li
                key={capability}
                className="flex gap-4 border-b border-border/60 py-3 text-[13px] leading-6 text-zinc-400 transition-colors duration-300 last:border-b-0 group-hover:border-border"
              >
                <span className="font-mono text-[10px] leading-6 text-signal/70">
                  {String(capabilityIndex + 1).padStart(2, "0")}
                </span>
                {capability}
              </li>
            ))}
          </ul>
        </div>
      </Link>
    </ScrollReveal>
  );
}

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <Layout>
      <HeroPanel
        badge={user ? "YOUR RESEARCH WORKSPACE" : "PAPER-ONLY STRATEGY RESEARCH"}
        title={
          user ? (
            <>
              Welcome back,
              <br />
              <span className="font-normal text-foreground/55">{user.name.split(" ")[0]}.</span>
            </>
          ) : (
            <>
              Fewer hot takes.
              <br />
              <span className="font-normal text-foreground/55">Better questions.</span>
            </>
          )
        }
        subtitle={
          user
            ? "Every tool below is unlocked. Pick a room and start testing — nothing you load here leaves this browser."
            : "Signalroom gives a trading idea a transparent test, a journal, and a reality check—before it gets your money."
        }
        action={
          user ? (
            // FlowButton draws its own pair of sliding arrows, so no icon child.
            <FlowButton onClick={() => navigate("/strategy-lab")}>Open the strategy lab</FlowButton>
          ) : (
            <FlowButton onClick={() => navigate("/signup")}>Create your account</FlowButton>
          )
        }
      />

      <section className="py-14">
        <ScrollReveal variant="rise">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <div className="eyebrow">
                <ArrowUpRight size={15} />
                {user ? "Your toolkit" : "What Signalroom offers"}
              </div>
              <h2 className="mt-4 max-w-xl font-display text-5xl font-semibold leading-[1.02] tracking-[-.018em] text-foreground md:text-6xl">
                {user ? (
                  <>
                    Everything, <span className="font-normal text-foreground/55">unlocked.</span>
                  </>
                ) : (
                  <>
                    Three rooms, <span className="font-normal text-foreground/55">one discipline.</span>
                  </>
                )}
              </h2>
            </div>
            <p className="max-w-sm text-sm leading-6 text-muted-foreground">
              {user
                ? "You have full access to each tool. They share one rule: no number appears without the assumptions that produced it."
                : "Each tool lives on its own page and states its own assumptions. Nothing here predicts a price."}
            </p>
          </div>
        </ScrollReveal>

        <div className="mt-12">
          {OFFERINGS.map((offering, index) => (
            <OfferingRow key={offering.name} offering={offering} index={index} />
          ))}
        </div>

        {!user && (
          <ScrollReveal variant="settle" className="mt-14">
            <div className="flex flex-col items-start justify-between gap-6 rounded-[28px] border border-border bg-card/70 p-8 md:flex-row md:items-center">
              <div>
                <h3 className="font-display text-3xl font-semibold tracking-[-.018em] text-foreground">
                  Create an account to keep your workspace.
                </h3>
                <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
                  Your account is stored in this browser only — there is no server, and no market data is ever uploaded.
                </p>
              </div>
              <ActionButton onClick={() => navigate("/signup")} className="shrink-0">
                Sign up
              </ActionButton>
            </div>
          </ScrollReveal>
        )}
      </section>
    </Layout>
  );
}
