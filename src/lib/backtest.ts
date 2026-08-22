export type Bar = { time: string; open: number; high: number; low: number; close: number; volume?: number };
export type BacktestResult = {
  equity: number[]; totalReturn: number; cagr: number | null; maxDrawdown: number;
  winRate: number | null; profitFactor: number | null; trades: number; averageRR: number | null;
  warnings: string[];
};

const num = (value: unknown) => Number(String(value ?? "").replace(/[,\$]/g, ""));

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findColumn(headers: string[], candidates: string[]) {
  const normalizedCandidates = candidates.map(normalizeHeader);
  return headers.findIndex((header) => {
    const normalizedHeader = normalizeHeader(header);
    return normalizedCandidates.some((candidate) => normalizedHeader === candidate || normalizedHeader.includes(candidate));
  });
}

function splitCsvLine(line: string, delimiter: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values.map((value) => value.trim());
}

function detectDelimiter(text: string) {
  const candidates = [",", ";", "\t", "|"];
  const header = text.split(/\r?\n/).find((line) => line.trim()) ?? "";
  let bestDelimiter = ",";
  let bestCount = -1;
  for (const delimiter of candidates) {
    const count = (header.match(new RegExp(`\\${delimiter}`, "g")) || []).length;
    if (count > bestCount) {
      bestCount = count;
      bestDelimiter = delimiter;
    }
  }
  return bestDelimiter;
}

export function parseCsv(text: string): Bar[] {
  const cleaned = text.replace(/^﻿/, "").trim();
  if (!cleaned) throw new Error("The file is empty.");

  const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error("The CSV needs a header row and at least one data row.");

  const delimiter = detectDelimiter(cleaned);
  const header = splitCsvLine(lines[0], delimiter);
  const date = findColumn(header, ["date", "datetime", "timestamp", "time"]);
  const open = findColumn(header, ["open"]);
  const high = findColumn(header, ["high"]);
  const low = findColumn(header, ["low"]);
  const close = findColumn(header, ["close", "adjclose", "adjustedclose"]);
  const volume = findColumn(header, ["volume"]);

  if ([date, open, high, low, close].some((index) => index < 0)) {
    throw new Error("CSV needs Date/Time, Open, High, Low and Close columns.");
  }

  const parsed = lines.slice(1).map((line) => splitCsvLine(line, delimiter)).map((row) => ({
    time: row[date] ?? "",
    open: num(row[open] ?? ""),
    high: num(row[high] ?? ""),
    low: num(row[low] ?? ""),
    close: num(row[close] ?? ""),
    volume: volume >= 0 ? num(row[volume] ?? "") : undefined
  })).filter((bar) => bar.time && [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite));

  if (!parsed.length) throw new Error("No usable rows were found in that file.");
  return parsed.sort((a, b) => a.time.localeCompare(b.time));
}

function ema(values: number[], period: number) {
  const multiplier = 2 / (period + 1); const output = new Array<number>(values.length).fill(NaN); let prior = values[0];
  values.forEach((value, index) => { prior = index === 0 ? value : (value - prior) * multiplier + prior; if (index >= period - 1) output[index] = prior; });
  return output;
}
function rsi(closes: number[], period = 14) {
  const output = new Array<number>(closes.length).fill(NaN); let gain = 0, loss = 0;
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1]; if (i <= period) { gain += Math.max(change, 0); loss += Math.max(-change, 0); if (i === period) output[i] = 100 - 100 / (1 + gain / Math.max(loss, Number.EPSILON)); continue; }
    gain = (gain * (period - 1) + Math.max(change, 0)) / period; loss = (loss * (period - 1) + Math.max(-change, 0)) / period; output[i] = 100 - 100 / (1 + gain / Math.max(loss, Number.EPSILON));
  } return output;
}
function atr(bars: Bar[], period = 14) {
  const output = new Array<number>(bars.length).fill(NaN); let average = 0;
  for (let i = 1; i < bars.length; i++) { const tr = Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close)); if (i <= period) { average += tr; if (i === period) output[i] = average / period; } else { average = (output[i - 1] * (period - 1) + tr) / period; output[i] = average; } } return output;
}

export function runTrendMomentum(bars: Bar[], startingCapital = 100000, feePercent = 0.15): BacktestResult {
  if (bars.length < 120) throw new Error("Upload at least 120 bars so the trend signals can initialize.");
  const closes = bars.map((bar) => bar.close), ema50 = ema(closes, 50), ema200 = ema(closes, 200), rsi14 = rsi(closes), atr14 = atr(bars);
  const fee = feePercent / 100; let cash = startingCapital, units = 0, entry = 0, stop = 0, target = 0, riskPerShare = 0, grossWins = 0, grossLosses = 0, wins = 0, trades = 0, rrTotal = 0;
  const equity: number[] = []; let peak = startingCapital, maxDrawdown = 0;
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    if (units > 0) {
      let exit = 0;
      if (bar.low <= stop) exit = stop;
      else if (bar.high >= target) exit = target;
      else if (bar.close < ema50[i] || rsi14[i] < 45) exit = bar.close;
      if (exit) {
        const proceeds = units * exit * (1 - fee);
        const profit = proceeds - units * entry * (1 + fee);
        cash += proceeds;
        trades++;
        if (profit >= 0) {
          wins++;
          grossWins += profit;
        } else {
          grossLosses += Math.abs(profit);
        }
        rrTotal += profit / Math.max(riskPerShare * units, Number.EPSILON);
        units = 0;
      }
    }

    const prevClose = i > 0 ? bars[i - 1].close : bar.close;
    const emaAlignment = ema50[i] > ema200[i] && (i === 0 || ema50[i - 1] <= ema200[i - 1]);
    const momentum = bar.close > prevClose && bar.close > ema50[i];
    const rsiCross = i > 0 && rsi14[i - 1] <= 55 && rsi14[i] > 55;
    const canEnter = i > 120 && units === 0 && bar.close > ema200[i] && emaAlignment && momentum && rsiCross && Number.isFinite(atr14[i]);
    if (canEnter) {
      riskPerShare = 1.5 * atr14[i];
      const riskCapital = Math.max(cash * 0.01, 100);
      const sizedUnits = riskCapital / riskPerShare;
      units = Math.min(sizedUnits, cash / (bar.close * (1 + fee)));
      entry = bar.close;
      stop = entry - riskPerShare;
      target = entry + 2.5 * atr14[i];
      cash -= units * entry * (1 + fee);
    }

    const value = cash + units * bar.close;
    equity.push(value);
    peak = Math.max(peak, value);
    maxDrawdown = Math.max(maxDrawdown, (peak - value) / peak);
  }

  const finalValue = equity[equity.length - 1];
  const years = Math.max((new Date(bars.at(-1)!.time).getTime() - new Date(bars[0].time).getTime()) / 31557600000, 0);
  const warnings = [
    "This is a single-instrument, paper-only backtest.",
    "The strategy uses a 1% risk budget and a 1.5× ATR stop with a 2.5× ATR target.",
    "Results are sensitive to the bar size and the assumptions you choose.",
    "Use a longer history and a consistent time frame for a more stable read."
  ];
  return {
    equity,
    totalReturn: finalValue / startingCapital - 1,
    cagr: years > 0 ? Math.pow(finalValue / startingCapital, 1 / years) - 1 : null,
    maxDrawdown,
    winRate: trades ? wins / trades : null,
    profitFactor: grossLosses ? grossWins / grossLosses : null,
    trades,
    averageRR: trades ? rrTotal / trades : null,
    warnings
  };
}
