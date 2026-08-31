import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";

const app = express();
const port = process.env.PORT || 8787;

app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const clients = new Set();
let binanceSocket = null;

const symbols = new Set([
  "btcusdt",
  "ethusdt"
]);

function broadcast(message) {
  const data = JSON.stringify(message);

  clients.forEach(function (client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

function connectBinance() {
  if (
    binanceSocket !== null &&
    (binanceSocket.readyState === WebSocket.OPEN ||
      binanceSocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  const streams = Array.from(symbols)
    .map(function (symbol) {
      return symbol + "@bookTicker";
    })
    .join("/");

  const url =
    "wss://stream.binance.com:9443/stream?streams=" +
    streams;

  binanceSocket = new WebSocket(url);

  binanceSocket.on("open", function () {
    console.log("Binance live market feed connected");

    broadcast({
      type: "status",
      marketDataConnected: true,
      provider: "Binance"
    });
  });

  binanceSocket.on("message", function (raw) {
    try {
      const packet = JSON.parse(raw.toString());
      const data = packet.data;

      if (!data || !data.s) {
        return;
      }

      const bid = Number(data.b);
      const ask = Number(data.a);

      broadcast({
        type: "quote",
        symbol: data.s,
        bid: bid,
        ask: ask,
        price: (bid + ask) / 2,
        timestamp: Date.now()
      });
    } catch {
      return;
    }
  });

  binanceSocket.on("close", function () {
    binanceSocket = null;

    broadcast({
      type: "status",
      marketDataConnected: false,
      provider: null
    });

    setTimeout(connectBinance, 3000);
  });

  binanceSocket.on("error", function () {
    if (binanceSocket !== null) {
      binanceSocket.close();
    }
  });
}

app.get("/api/health", function (_req, res) {
  res.json({
    ok: true,
    service: "AI MONSTER V71 API Gateway",
    brokerConnected: false,
    marketDataConnected:
      binanceSocket !== null &&
      binanceSocket.readyState === WebSocket.OPEN
  });
});


app.get("/api/market/candles", async function (req, res) {
  try {
    const symbol = String(req.query.symbol || "BTCUSDT").toUpperCase();
    const interval = String(req.query.interval || "1m");
    const limit = Math.min(
      Math.max(Number(req.query.limit || 100), 1),
      1000
    );

    const allowedIntervals = new Set([
      "1m",
      "3m",
      "5m",
      "15m",
      "30m",
      "1h",
      "2h",
      "4h",
      "6h",
      "12h",
      "1d"
    ]);

    if (!allowedIntervals.has(interval)) {
      return res.status(400).json({
        error: "INVALID_INTERVAL"
      });
    }

    const url =
      "https://api.binance.com/api/v3/klines" +
      "?symbol=" +
      encodeURIComponent(symbol) +
      "&interval=" +
      encodeURIComponent(interval) +
      "&limit=" +
      String(limit);

    const response = await fetch(url);

    if (!response.ok) {
      return res.status(502).json({
        error: "MARKET_PROVIDER_ERROR",
        status: response.status
      });
    }

    const rows = await response.json();

    const candles = rows.map(function (row) {
      return {
        time: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5])
      };
    });

    res.json({
      provider: "Binance",
      symbol: symbol,
      interval: interval,
      candles: candles
    });
  } catch (error) {
    res.status(500).json({
      error: "CANDLE_REQUEST_FAILED",
      message: error instanceof Error
        ? error.message
        : "Unknown error"
    });
  }
});

app.get("/api/market/status", function (_req, res) {
  res.json({
    connected:
      binanceSocket !== null &&
      binanceSocket.readyState === WebSocket.OPEN,
    provider: "Binance"
  });
});

app.get("/api/broker/status", function (_req, res) {
  res.json({
    connected: false,
    broker: null,
    mode: null
  });
});

app.get("/api/account", function (_req, res) {
  res.status(503).json({
    error: "BROKER_NOT_CONNECTED",
    message: "No broker account is connected"
  });
});

app.post("/api/orders", function (_req, res) {
  res.status(503).json({
    error: "BROKER_NOT_CONNECTED",
    message: "No broker is connected"
  });
});

const marketServer = new WebSocketServer({
  server: server,
  path: "/market"
});

marketServer.on("connection", function (socket) {
  clients.add(socket);

  socket.send(
    JSON.stringify({
      type: "status",
      marketDataConnected:
        binanceSocket !== null &&
        binanceSocket.readyState === WebSocket.OPEN,
      provider: "Binance"
    })
  );

  socket.on("close", function () {
    clients.delete(socket);
  });
});

server.listen(port, function () {
  console.log(
    "AI MONSTER V71 API Gateway listening on " + port
  );

  connectBinance();
});
