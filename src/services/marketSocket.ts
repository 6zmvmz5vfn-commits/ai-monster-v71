export type LiveQuote = {
  symbol: string;
  bid: number;
  ask: number;
  price: number;
  timestamp: number;
};

type QuoteListener = (quote: LiveQuote) => void;

const listeners = new Set<QuoteListener>();

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;

export function subscribeLiveQuote(listener: QuoteListener) {
  listeners.add(listener);
  connectMarketSocket();

  return function unsubscribe() {
    listeners.delete(listener);
  };
}

function connectMarketSocket() {
  if (
    socket !== null &&
    (socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  const protocol =
    window.location.protocol === "https:" ? "wss:" : "ws:";

  const socketUrl =
    protocol + "//" + window.location.host + "/market";

  socket = new WebSocket(socketUrl);

  socket.onmessage = function (event) {
    try {
      const message = JSON.parse(event.data);

      if (message.type !== "quote") {
        return;
      }

      const quote: LiveQuote = {
        symbol: String(message.symbol),
        bid: Number(message.bid),
        ask: Number(message.ask),
        price: Number(message.price),
        timestamp: Number(message.timestamp)
      };

      listeners.forEach(function (listener) {
        listener(quote);
      });
    } catch {
      return;
    }
  };

  socket.onclose = function () {
    socket = null;

    if (listeners.size > 0) {
      reconnectTimer = window.setTimeout(function () {
        reconnectTimer = null;
        connectMarketSocket();
      }, 2000);
    }
  };

  socket.onerror = function () {
    if (socket !== null) {
      socket.close();
    }
  };
}

export function disconnectLiveQuotes() {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (socket !== null) {
    socket.close();
    socket = null;
  }
}
