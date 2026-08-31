import {
  subscribeLiveQuote,
  type LiveQuote,
} from "./marketSocket";

type LiveMarketListener = (quote: LiveQuote) => void;

export function connectLiveMarket(
  listener: LiveMarketListener
) {
  return subscribeLiveQuote(listener);
}
