export type LiveCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

const candles = new Map<string, LiveCandle[]>();

export function updateCandle(
  symbol: string,
  price: number
): LiveCandle[] {
  const key = symbol.toUpperCase();
  const now = Math.floor(Date.now() / 60000) * 60000;

  const existing = candles.get(key) ?? [];
  const last = existing[existing.length - 1];

  if (!last || last.time !== now) {
    const candle: LiveCandle = {
      time: now,
      open: price,
      high: price,
      low: price,
      close: price
    };

    const next = [...existing, candle].slice(-100);
    candles.set(key, next);
    return next;
  }

  const updated: LiveCandle = {
    ...last,
    high: Math.max(last.high, price),
    low: Math.min(last.low, price),
    close: price
  };

  const next = [...existing.slice(0, -1), updated];
  candles.set(key, next);

  return next;
}

export function getCandles(symbol: string): LiveCandle[] {
  return candles.get(symbol.toUpperCase()) ?? [];
}
