export type MarketQuote = {
  symbol: string;
  bid: number | null;
  ask: number | null;
  timestamp: number;
};

export type MarketCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type MarketConnectionState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "ERROR";

export interface MarketDataProvider {
  connect(): Promise<void>;
  disconnect(): void;
  subscribe(symbol: string): void;
  unsubscribe(symbol: string): void;
  onQuote(callback: (quote: MarketQuote) => void): () => void;
  onCandle(callback: (candle: MarketCandle) => void): () => void;
  getState(): MarketConnectionState;
}
