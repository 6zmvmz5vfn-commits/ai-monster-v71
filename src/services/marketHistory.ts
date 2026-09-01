import type { LiveCandle } from "./candleStore";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "/api";

export async function loadHistoricalCandles(
  symbol: string,
  timeframe: string,
  limit = 100
): Promise<LiveCandle[]> {
  const response = await fetch(
    `${API_BASE}/market/candles?symbol=${encodeURIComponent(
      symbol
    )}&interval=${encodeURIComponent(timeframe)}&limit=${limit}`
  );

  if (!response.ok) {
    throw new Error(
      `Historical market data failed: ${response.status}`
    );
  }

  const data: unknown = await response.json();

  if (
    typeof data !== "object" ||
    data === null ||
    !("candles" in data) ||
    !Array.isArray(data.candles)
  ) {
    throw new Error("Invalid historical candle response");
  }

  return data.candles as LiveCandle[];
}