# Adversary — Product Requirements Document

**Version:** 1.0
**Date:** 21 August 2026
**Author:** Aarav
**Submission target:** Lumos Fellows Builder Competition, final deadline 23 August 2026
**Build window:** ~48 hours (Fri 21 evening → Sun 23 evening)

---

## 1. One-line pitch

**A backtester that tries to prove your strategy is fake.**

---

## 2. The problem

Every backtesting tool ever built is designed to make you feel good. You write a
trading strategy, you run it, you get an equity curve. If the curve slopes down,
you change a parameter and run it again. You keep doing this until the curve
slopes up. Then you stop, and you believe you have found something.

You have not found something. You have found the configuration that best fits the
one sample of history you happened to test on. This is not a subtle statistical
point — it is arithmetic. If you test a thousand strategies against noise, the
best one will look excellent. Search hard enough and randomness will hand you a
2.5 Sharpe ratio and a smooth equity curve.

The industry name for this is backtest overfitting. It is the single largest
source of wasted effort in quantitative finance, and it is almost entirely
invisible to the person committing it, because:

1. **The tooling only rewards success.** No standard backtester asks "how many
   variants did you try before this one?" The search cost is never recorded, so
   it is never charged.
2. **Failed attempts vanish.** You remember the strategy that worked. You do not
   remember the ninety-eight that didn't, so you cannot correct for them.
3. **The correction methods exist but are inaccessible.** Deflated Sharpe Ratio,
   Probability of Backtest Overfitting, and minimum track record length are all
   published, well-established techniques. They live in academic papers and
   research-desk Python libraries. There is no tool a student, a retail trader,
   or a beginner can point at their own strategy.

The result is a market full of people — retail traders, finfluencers, students
building portfolios, and small funds — who sincerely believe they have an edge,
have real numbers to show for it, and are wrong.

**Adversary exists to charge the search cost.**

---

## 3. Product thesis

The tool's defining property is that it is **adversarial by default.** It does
not present your results and let you interpret them. It actively attempts to
falsify your strategy using every method available, and only reports survival if
it genuinely failed to kill it.

Three principles follow:

**P1 — The null hypothesis is that you have nothing.** Every output is framed
against "what would this look like if the strategy had no edge at all?"

**P2 — Search is a cost, and it is always charged.** Every strategy variant the
user runs increments a trial counter. Final significance is adjusted for the
size of the search. You cannot quietly forget the ones that failed.

**P3 — The verdict is blunt.** Not a dashboard of ambiguous metrics. Three
states: **DEAD**, **WOUNDED**, **SURVIVED** — with the specific reason attached.

---

## 4. Target users

| User | Need | Why they'd use it |
|---|---|---|
| **Primary — Students & self-taught quants** | Learning backtesting; no access to institutional validation tooling | The only free tool that tells them their result is probably noise, and explains why |
| **Secondary — Retail algo traders** | About to deploy real capital on a backtested strategy | Cheap insurance against a costly mistake |
| **Tertiary — Finance educators** | Teaching why backtests mislead | A live demonstration is worth more than a lecture |
| **Sceptics** | Evaluating someone else's performance claim | Paste in the numbers, get an independent verdict |

**Explicit non-user:** professional quant researchers with existing internal
validation stacks. They already have this. That is fine — it is not who this is
for.

---

## 5. Non-goals (v1)

Stating these clearly is what keeps the 48 hours survivable.

- ❌ Live trading, broker integration, or order execution
- ❌ Real-time or intraday data
- ❌ Options, futures, crypto derivatives, or multi-asset portfolios
- ❌ User accounts, authentication, saved state across devices
- ❌ Arbitrary user-written code execution
- ❌ Machine-learning strategies
- ❌ Mobile-first design (must be usable on mobile; will be optimised for desktop)

---

## 6. Core user flow

```
1. Pick a market          → choose from bundled tickers, or upload a CSV
2. Describe a strategy    → plain English, or use the visual builder
3. Compile                → English is parsed into a typed strategy spec, shown
                            back to the user for confirmation
4. Backtest               → equity curve, standard metrics
5. ATTACK                 → six adversarial tests run in sequence, visibly
6. Verdict                → DEAD / WOUNDED / SURVIVED, with reasons ranked
7. Share                  → permalink encoding the strategy spec + verdict
```

The attack phase is the product. It should be **visible and theatrical** — tests
running one at a time, each landing a verdict, the health bar dropping. This is
what makes a sixty-second video work.

---

## 7. Feature specification

### 7.1 Strategy grammar

Strategies are **not** arbitrary code. They are composed from a constrained
grammar. This is a deliberate design decision: it makes the compiler tractable,
makes execution safe, and — critically — makes the search space *enumerable*,
which is what the generator in §7.6 needs.

```
STRATEGY := ENTRY + EXIT + SIZING + UNIVERSE

ENTRY  := SIGNAL COMPARATOR THRESHOLD
        | SIGNAL crosses_above SIGNAL
        | SIGNAL crosses_below SIGNAL

SIGNAL := sma(n) | ema(n) | rsi(n) | zscore(n) | momentum(n)
        | volatility(n) | price | volume_ratio(n)

EXIT   := opposite_entry_signal
        | stop_loss(pct) | take_profit(pct)
        | time_stop(days) | trailing_stop(pct)

SIZING := fixed_fraction(pct)
        | inverse_volatility(lookback)
        | equal_weight

UNIVERSE := single_ticker | ticker_list
```

Six signal families × parameter ranges × five exit types × three sizing rules
gives a search space in the tens of thousands — more than enough to demonstrate
the overfitting point, small enough to enumerate.

### 7.2 Compiler (English → spec)

**Input:** free text, e.g. *"buy when the 50-day moving average crosses above
the 200-day, exit on a 5% stop loss, size positions by inverse volatility"*

**Method:** a single LLM call whose system prompt contains the grammar and which
is instructed to return **only** JSON matching the strategy spec schema. No
preamble, no markdown fences.

**Validation layer (deterministic, not LLM):**
- All referenced signals exist in the grammar
- All parameters within permitted ranges
- No lookahead: no signal references data at or after the execution bar
- Exit condition is reachable
- Sizing sums to ≤ 100% exposure

**Failure handling:** if the LLM returns something invalid, the user is shown the
visual builder pre-filled with whatever *was* parseable. The compiler must never
be a dead end.

**Critical constraint:** the LLM produces *parameters*, never *logic*. Execution
is entirely deterministic. This is both a safety property and a correctness
property.

### 7.3 Backtest engine

Standard vectorised event loop. Deliberately simple, deliberately honest.

- Daily bars, long/short/flat
- Signals computed on bar `t`, orders execute at open of bar `t+1` (no lookahead)
- Transaction costs: configurable basis points per side, default 10bps
- Slippage: configurable, default 5bps
- Outputs: equity curve, per-trade log, drawdown series, exposure series

**Metrics:** total return, CAGR, annualised Sharpe, Sortino, max drawdown,
Calmar, win rate, average win/loss, trade count, time in market, turnover.

These metrics are shown **greyed out and provisional** until the attack phase
completes. The user should not be allowed to feel good about a number that
hasn't been challenged yet. This is a UI decision that carries the entire product
thesis.

### 7.4 The six attacks

Each attack returns a status of `pass` / `warn` / `fail`, a one-line plain-English
explanation, and a supporting chart.

---

**Attack 1 — Search cost adjustment (Deflated Sharpe Ratio)**

*The question:* Does your Sharpe survive being told how many variants you tried?

*Method:* Bailey & López de Prado's Deflated Sharpe Ratio. Requires the number
of independent trials `N`, the variance of Sharpe ratios across those trials, and
the skewness and kurtosis of the strategy's returns.

The expected maximum Sharpe under the null (no skill) is approximately:

```
SR₀ = sqrt(V) · [ (1−γ)·Z⁻¹(1 − 1/N) + γ·Z⁻¹(1 − 1/(N·e)) ]
```

where `γ` is the Euler–Mascheroni constant (≈0.5772), `V` is the variance of
trial Sharpes, and `Z⁻¹` is the inverse standard normal CDF.

The deflated statistic is then:

```
DSR = Z[ (SR − SR₀)·sqrt(T−1) / sqrt(1 − γ₃·SR + ((γ₄−1)/4)·SR²) ]
```

with `γ₃` the skewness and `γ₄` the kurtosis of returns, `T` the number of
observations.

*Where N comes from:* the session trial counter (every backtest the user has run
this session) plus, if the generator was used, the number of strategies it swept.
This is the number nobody else measures.

*Thresholds:* DSR > 0.95 → pass. 0.80–0.95 → warn. < 0.80 → fail.

> ⚠️ **Verify these formulas against the source papers before shipping.** I am
> reproducing them from memory and the constants and exact form of the variance
> term should be checked against Bailey & López de Prado's published work. Given
> what this product is *about*, shipping a mis-specified statistic would be
> genuinely embarrassing. Budget thirty minutes for this.

---

**Attack 2 — Parameter stability**

*The question:* Did you find a robust region, or a lucky spike?

*Method:* Sweep each numeric parameter ±50% around the chosen value in a grid.
Compute Sharpe at every point. Measure the ratio of the chosen point's Sharpe to
the median Sharpe of its immediate neighbourhood, and the fraction of the local
neighbourhood that remains profitable.

*Interpretation:* a real edge sits on a plateau — nearby parameters work almost
as well. An overfit sits on a needle: move the lookback from 50 to 45 and the
edge evaporates.

*Output:* heatmap for two-parameter strategies, line chart for one. The needle is
visually obvious, which makes this the best chart for the video.

*Thresholds:* chosen Sharpe ≤ 1.3× neighbourhood median AND ≥60% of neighbours
profitable → pass. Otherwise warn or fail.

---

**Attack 3 — Regime dependence**

*The question:* Did all your returns come from one lucky period?

*Method:* Partition the sample three ways —
(a) by calendar year,
(b) by realised volatility tercile of the market,
(c) by market direction (up / down / flat trailing 12-month).
Compute Sharpe and return contribution within each bucket.

*Key statistic:* the proportion of total return generated by the single best
period. If one year out of twelve produced 70% of the return, the strategy is a
bet on that year, not an edge.

*Thresholds:* best single year < 40% of total return → pass. 40–60% → warn.
>60% → fail.

---

**Attack 4 — Cost sensitivity**

*The question:* How much friction kills it?

*Method:* Sweep round-trip costs from 0 to 100bps. Find the breakeven point where
Sharpe crosses zero. Report it against realistic cost levels for the asset class.

*Why it matters:* high-turnover strategies routinely look excellent at zero cost
and are worthless at 15bps. Most beginner backtesters default to zero cost.

*Thresholds:* survives >50bps → pass. 15–50bps → warn. Dies below 15bps → fail.

---

**Attack 5 — Noise benchmark**

*The question:* Did you beat a coin flip that traded as often as you did?

*Method:* Generate 1,000 random strategies matched to yours on trade count,
average holding period, and directional bias, but with randomised entry timing.
Run each. Build the distribution of Sharpes. Report the user's percentile.

*This is the most intuitive attack for a non-technical audience.* "Your strategy
beat 61% of random strategies" needs no explanation and is quietly devastating.

*Thresholds:* >95th percentile → pass. 80–95th → warn. <80th → fail.

---

**Attack 6 — Synthetic markets**

*The question:* Does it work on histories that never happened?

*Method:* Generate 200 synthetic price series preserving the statistical
character of the real one — volatility clustering (GARCH-like), fat tails,
realistic autocorrelation — via block bootstrap of returns as the v1
implementation. Run the strategy on each. Report the fraction where it remains
profitable.

*Rationale:* history happened once. A strategy tuned to one realisation of a
stochastic process has learned that realisation, not the process.

*Implementation note:* stationary block bootstrap with mean block length ~20 days
is sufficient for v1 and is far cheaper to build than a fitted GARCH. Do the
cheap version.

*Thresholds:* profitable in >70% of synthetic paths → pass. 40–70% → warn.
<40% → fail.

---

### 7.5 Verdict engine

```
DEAD      — 2+ attacks failed, OR the DSR attack failed
WOUNDED   — 1 attack failed, or 3+ warnings
SURVIVED  — 0 failures, ≤2 warnings
```

The DSR failure is an automatic kill regardless of other results, because
failing it means the result is statistically indistinguishable from the best of
a random search — which is the whole thesis.

**Output format:**
- The verdict, large and unambiguous
- Failure reasons ranked by severity, each in one plain sentence
- "What would have to change" — the specific condition under which the verdict
  would improve (e.g. *"needs 6 more years of data to reach significance at this
  Sharpe"*, using minimum track record length)
- Shareable permalink encoding spec + verdict

### 7.6 Strategy generator

This is the feature that makes the product memorable, and it carries a design
tension that must be handled deliberately.

**The tension:** a tool that generates strategies and tests them until one passes
is precisely the data-mining machine Adversary exists to catch. Built naively,
you have shipped the disease and the cure in one box.

**The resolution:** the generator's purpose is *demonstration*, not discovery. It
serves three functions:

**(a) Ideation.** The user describes a direction — "mean reversion on liquid
large caps" — and the generator proposes concrete, editable variants from the
grammar. Genuinely useful on its own.

**(b) Measuring the null distribution.** Deflated Sharpe requires the variance of
Sharpe ratios across trials. In every published implementation this number is
*estimated* or *assumed*. Here it is **measured directly** by sweeping the
generated population. This is the technically strongest idea in the product and
worth saying out loud in the submission.

**(c) The demonstration.** Generate 1,000 strategies against real price data.
Show the best one: it will have an excellent Sharpe and a beautiful equity curve.
Then generate 1,000 against a pure random walk with matched volatility. Show the
best one: it will look **just as good.** Side by side.

**This is the demo that wins the competition.** It requires zero finance
background to understand. Anyone who sees two equally beautiful equity curves,
one built on real data and one built on noise, understands the entire problem in
under five seconds.

**Every generated strategy increments the global trial counter.** Using the
generator makes the user's subsequent DSR bar dramatically harder to clear. That
is correct behaviour and should be stated in the UI: *"You've now searched 1,000
strategies. Your significance threshold has risen accordingly."*

---

## 8. Technical architecture

### 8.1 Stack

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | React + Vite | Fast, familiar, deploys anywhere |
| Compute | **Client-side JS in a Web Worker** | No backend to build, deploy, or pay for. 48-hour constraint dominates. |
| Charts | Recharts or uPlot | uPlot if the 1,000-strategy sweep needs performance |
| LLM | Anthropic API (Claude) | Compiler + verdict prose only |
| Hosting | Vercel | Zero-config, instant public URL, free |
| Data | Pre-bundled JSON | See §8.3 |

**The single most important architectural decision: no backend.** The entire
computation runs in the browser. This removes deployment, scaling, cost, latency,
and auth from the critical path, and it removes any risk of a demo failing
because a server is cold. Everything except the LLM compiler call runs offline.

### 8.2 Performance

The 1,000-strategy sweep is the only heavy operation. Budget:

- 1,000 strategies × 3,000 daily bars = 3M bar-evaluations
- Vectorised typed-array implementation: comfortably under 3 seconds in a Worker
- Must run in a **Web Worker** so the UI stays responsive
- Stream progress back to the main thread — the progress bar *is* the theatre

Pre-compute all signal series once per dataset and cache them. Strategies then
only combine cached arrays rather than recomputing indicators. This is the
difference between 3 seconds and 3 minutes.

### 8.3 Data

**Do not depend on a live API.** CORS, rate limits, and key management will
consume hours you do not have, and an API outage during judging would be fatal.

**Ship bundled data:** 8–12 liquid instruments, daily OHLCV, 2005–2025, as
compressed JSON in the repo. Suggested: SPY, QQQ, a couple of large-cap single
names, gold, and one Indian index if you can source it cleanly. Roughly 5,000
bars per instrument is a trivial payload.

**Plus CSV upload** for users bringing their own data — schema `date, open, high,
low, close, volume`. This is what makes it useful beyond the bundled set.

**Provenance must be stated in the UI.** Given the product's subject matter,
being vague about where the data came from would undercut everything.

### 8.4 State model

```typescript
interface Session {
  trialCount: number;          // every backtest run, ever, this session
  generatorSweeps: number;     // strategies produced by the generator
  trialSharpes: number[];      // for measuring the null distribution
  history: StrategyRun[];
}

interface StrategySpec {
  universe: string[];
  entry: EntryRule;
  exit: ExitRule[];
  sizing: SizingRule;
  params: Record<string, number>;
}

interface AttackResult {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  statistic: number;
  explanation: string;
  chartData: unknown;
}

interface Verdict {
  status: 'DEAD' | 'WOUNDED' | 'SURVIVED';
  attacks: AttackResult[];
  reasons: string[];          // ranked by severity
  remedy: string;             // "what would have to change"
}
```

**Trial count persists in localStorage across the session.** The user cannot
escape their search history by refreshing. This is a small detail that carries
the product's entire moral position.

---

## 9. Build plan — 48 hours

Realistic, with the sequencing chosen so that **there is a shippable product at
the end of every block**. If you run out of time at any checkpoint, what exists
is still launchable.

### Friday 21st, evening (4 hrs) — Foundation
- [ ] Vite + React project, deployed to Vercel within the first 30 minutes
      *(deploy first, always — never leave deployment to the end)*
- [ ] Source and bundle price data; write the loader
- [ ] Signal computation library: SMA, EMA, RSI, z-score, momentum, volatility
- [ ] Backtest engine core: signal → position → equity curve
- [ ] Verify against a hand-computed example. **Do not skip this.**

**Checkpoint: a working backtester with a hardcoded strategy.**

### Saturday 22nd, morning (5 hrs) — Attacks
- [ ] Metrics module: Sharpe, Sortino, drawdown, Calmar, trade stats
- [ ] Attack 2 (parameter stability) — grid sweep
- [ ] Attack 3 (regime dependence) — partition and aggregate
- [ ] Attack 4 (cost sensitivity) — cost sweep to breakeven
- [ ] Attack 5 (noise benchmark) — matched random strategies

**Checkpoint: four attacks working, output to console.**

### Saturday 22nd, afternoon (5 hrs) — Generator and the hard statistics
- [ ] Grammar enumeration and random strategy sampler
- [ ] Web Worker for the 1,000-strategy sweep, with progress streaming
- [ ] Block bootstrap for synthetic series → Attack 6
- [ ] Deflated Sharpe implementation → Attack 1
      **← verify formulas against source papers here**
- [ ] Verdict engine

**Checkpoint: the full analytical product exists, headless.**

### Saturday 22nd, evening (4 hrs) — Interface
- [ ] Strategy builder UI (visual, dropdown-based — build this *before* the
      English compiler; it is the fallback if the compiler misbehaves)
- [ ] Equity curve, drawdown chart
- [ ] Attack sequence UI — tests running one at a time, health bar dropping
- [ ] Verdict screen

**Checkpoint: a usable product. If everything after this fails, you can still
launch.**

### Sunday 23rd, morning (4 hrs) — The compiler and the demo
- [ ] English → spec LLM compiler with the deterministic validation layer
- [ ] The headline demo, as a one-click button: **"Best of 1,000 on real data vs.
      best of 1,000 on noise"** — side by side
- [ ] Permalink sharing
- [ ] Mobile: make it not broken. Not beautiful. Not broken.

### Sunday 23rd, afternoon (3 hrs) — Launch
- [ ] Record the sixty-second video
- [ ] Write the 150-word story
- [ ] **Distribute** (see §10)
- [ ] Collect and record usage numbers
- [ ] Submit

### Cut list, in order

If you fall behind, cut in exactly this sequence:
1. Synthetic markets (Attack 6) — most build cost, least demo value
2. Permalink sharing
3. English compiler — the visual builder covers the same ground
4. Mobile polish

**Never cut:** the noise benchmark, the parameter stability heatmap, or the
1,000-strategy demo. Those three *are* the product.

---

## 10. Launch and distribution

The competition explicitly asks: *"Tell us what happened after you launched it.
Add numbers if you have them."* With roughly six hours between launch and
submission, distribution has to be planned in advance, not improvised.

**Pre-write everything on Saturday night.** On Sunday you post, you do not draft.

| Channel | Action | Realistic yield |
|---|---|---|
| r/algotrading | Post the noise-vs-real demo as the hook, tool as the payoff | Highest-value audience; ~10k impressions if it lands |
| r/quant, r/IndiaInvestments | Same, adapted | Supplementary |
| Hacker News (Show HN) | "Show HN: A backtester that tries to prove your strategy is fake" | High variance; free to try |
| X / Twitter | The two equity curves, side by side, as an image. This is the shareable artifact. | Depends on reach |
| Discord (quant/algotrading servers) | Direct post, high conversion | Small but engaged |
| Your school / personal network | Direct messages | Small, guaranteed |
| LinkedIn | Framed as a student research tool | Moderate |

**Instrument from the first minute.** Vercel Analytics (free, zero-config) plus
a simple counter for backtests-run and verdicts-issued. If you launch without
analytics you will have no numbers, and "Results" is one of five judging
criteria.

**Numbers worth reporting** — real ones, whatever they turn out to be:
- unique visitors
- strategies tested
- verdicts issued, split by DEAD / WOUNDED / SURVIVED
- the DEAD proportion is itself an interesting finding and worth stating

**Do not inflate any of this.** Report what happened. A tool whose entire premise
is honest measurement, submitted with padded usage numbers, fails on its own
terms — and judges who have read a hundred applications can tell.

---

## 11. Lumos submission mapping

Their five criteria, and what answers each:

| Criterion | What Adversary offers |
|---|---|
| **Your work** — what you did and why | A thesis, not a feature: backtesting tools flatter their users, and that costs people real money. Ties to your existing research on deep hedging and pre-registration. |
| **Getting started** — how you made the idea real | Shipped in 48 hours; deployed on hour one; scoped by an explicit cut list. |
| **Results** — how it helped | Live usage numbers plus the distribution of verdicts issued. |
| **Problem-solving** — time and tools | Constrained grammar instead of arbitrary code execution; client-side compute to eliminate backend risk; deterministic detection with generative explanation. |
| **Clear story** — how clearly you explain it | The noise-vs-real demo explains the entire problem in five seconds with no finance background required. |

### 11.1 The 150-word story (draft — rewrite in your own voice)

> Every backtesting tool is built to make you feel good. You tweak parameters
> until the equity curve goes up, and the software congratulates you. But if you
> test a thousand strategies against pure noise, the best one will still look
> excellent — that is just arithmetic, and it is how most people who think they
> have found a trading edge are fooling themselves.
>
> I built Adversary to invert this. It takes your strategy and spends its effort
> trying to kill it: adjusting your Sharpe ratio for how many variants you
> secretly tried, checking whether you found a robust region or a lucky spike,
> testing whether all your returns came from one good year. It returns one of
> three verdicts — dead, wounded, or survived.
>
> The hardest part was the generator. A tool that produces strategies and tests
> them until one passes is exactly the problem I was attacking. I made it the
> demonstration instead: it generates a thousand strategies on real data and a
> thousand on noise, and shows you that the winners are indistinguishable.

*(That is currently ~210 words. Cut to 150 — losing the third paragraph's setup
and tightening the first is the cleanest path.)*

### 11.2 Sixty-second video script

| Time | Content |
|---|---|
| 0:00–0:08 | Two equity curves side by side, both beautiful. "One of these is a real strategy. One is generated from pure noise. Can you tell which?" |
| 0:08–0:15 | Reveal: they're both from a search of a thousand strategies. One searched real data, one searched randomness. "This is why most backtests lie." |
| 0:15–0:25 | Screen recording: type a strategy in plain English. It compiles. It backtests. Good-looking result appears — greyed out. |
| 0:25–0:45 | Attacks run in sequence. Parameter heatmap shows a needle. Regime chart shows one dominant year. Health bar drops with each. |
| 0:45–0:55 | Verdict: **DEAD**. Reasons listed in plain English. |
| 0:55–1:00 | "Adversary. It doesn't help you find a strategy. It stops you believing in one that isn't there." URL. |

**Record this on Saturday night against whatever exists.** Re-record Sunday if
there's time. Do not leave it until Sunday afternoon with no fallback.

---

## 12. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Deflated Sharpe implemented incorrectly | **High** — undermines the entire premise | Verify against source papers; unit test against a known example; if uncertain, state the limitation in the UI rather than hiding it |
| Sweep too slow, UI freezes | High | Web Worker from the start; pre-compute and cache signals; typed arrays |
| LLM compiler unreliable | Medium | Visual builder built first and always available as fallback |
| No users by submission time | Medium | Distribution channels pre-written Saturday; personal network as guaranteed floor |
| Scope creep | **High** | The cut list in §9 is binding. Read it when tempted. |
| Data source problems | Medium | Bundled static data; no live API dependency |
| Running out of time | High | Every block ends in a shippable state |

**The largest risk is scope.** Every idea in the roadmap will feel essential at
2am on Saturday. The product that ships with six working attacks and no English
compiler beats the product that is 80% complete with ten.

---

## 13. Post-competition roadmap

Worth stating in the submission — it shows this isn't a weekend throwaway.

**Phase 2 — Depth**
- Probability of Backtest Overfitting via CSCV (combinatorially symmetric
  cross-validation)
- Walk-forward analysis with rolling re-optimisation
- Bootstrapped Sharpe difference tests — "is strategy A actually better than B,
  or can't you tell?"
- Minimum track record length as a headline output
- Factor attribution: how much of this is just market beta?

**Phase 3 — Scope**
- Multi-asset portfolios and correlation-aware sizing
- Fitted GARCH synthetic markets, replacing block bootstrap
- Market impact modelling for larger position sizes
- Options and non-linear payoffs

**Phase 4 — The research arm**
- Pre-registration: lock a strategy hypothesis *before* testing, timestamped
- Longitudinal scoring: track whether SURVIVED verdicts actually survive
  out-of-sample. **This is the only real validation of the tool itself**, and it
  connects directly to the deep hedging pre-registration work.
- Publish the aggregate distribution of verdicts as a dataset: what fraction of
  strategies people actually test are statistically distinguishable from noise?

That last item is a genuine research contribution, and no one has the data to
answer it because no one has built the instrument.

---

## 14. Open decisions

Things I could not settle without your input, listed so they don't get lost:

1. **Price data source** — what can you actually get by tonight? This determines
   whether Friday evening is spent on plumbing or on the engine.
2. **Indian market data** — worth including for distribution reach, but only if
   sourcing it is genuinely quick.
3. **Name** — "Adversary" is strong. "Devil's Advocate" is warmer and more
   legible to non-technical judges. Your call.
4. **English compiler in v1 or v2** — it is the best demo moment and the biggest
   time risk. Decide Saturday evening based on where you actually are.
