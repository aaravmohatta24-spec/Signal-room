# Signalroom

A browser-only, paper-only strategy research lab. It includes an S&P 500 trend + momentum backtester and a FOMO calculator.

## Run locally

```bash
npm install
npm run dev
```

## Load the S&P 500 data

The website does not bundle market data. This keeps the build small and lets the user explicitly choose the series they want to test.

```bash
python -m pip install -r requirements-data.txt
python scripts/download_sp500.py
```

Open the downloaded dataset folder, find a CSV with `Date`/`Time`, `Open`, `High`, `Low`, `Close`, and ideally `Volume`, then use **Upload OHLCV CSV** in the Strategy Lab. The CSV is parsed locally in the browser and is not uploaded anywhere.

The supplied strategy is designed for 1-hour or 4-hour OHLCV data. A daily data file can still run, but it is a different test and the interface warns about that.

## Project structure

- `src/components/ui/hero-dithering-card.tsx` — the supplied dithering CTA, adapted for Signalroom
- `src/lib/backtest.ts` — CSV parsing and transparent EMA/RSI/ATR strategy rules
- `src/App.tsx` — homepage, FOMO calculator, and strategy lab

This Vite project uses the standard `src/components/ui` location. The `@/components/ui` alias maps there, matching shadcn/ui conventions while keeping application source under `src`.
