import express from "express";
import cors from "cors";
import http from "http";
import crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

const app = express();
const port = Number(process.env.PORT || 8787);

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));

const server = http.createServer(app);
const clients = new Set();
let binanceSocket = null;

const symbols = new Set(["btcusdt", "ethusdt", "xrpusdt", "solusdt"]);
const sessionStore = new Map();
const authUsers = new Map();

const brokerState = {
  connected: false,
  broker: null,
  mode: null,
  config: null,
};

function broadcast(message) {
  const data = JSON.stringify(message);

  clients.forEach(function (client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

function buildToken() {
  return "session_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function safeUser(user) {
  if (!user) {
    return null;
  }

  return {
    email: String(user.email || "").trim().toLowerCase(),
    name: String(user.name || "").trim(),
  };
}

function createSession(user) {
  const token = buildToken();
  const expiresAt = Date.now() + 1000 * 60 * 60 * 12;
  const payload = {
    token,
    user: safeUser(user),
    expiresAt,
  };

  sessionStore.set(token, payload);
  return payload;
}

function parseAuthToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length).trim();
}

function currentUser(req) {
  const token = parseAuthToken(req);
  if (!token) {
    return null;
  }

  const session = sessionStore.get(token);
  if (!session) {
    return null;
  }

  if (Date.now() > session.expiresAt) {
    sessionStore.delete(token);
    return null;
  }

  return session.user;
}

function requireSession(req, res, next) {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({
      error: "AUTH_REQUIRED",
      message: "Authentication required.",
    });
  }

  req.user = user;
  return next();
}

const requireAuth = requireSession;

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

  const url = "wss://stream.binance.com:9443/stream?streams=" + streams;

  binanceSocket = new WebSocket(url);

  binanceSocket.on("open", function () {
    console.log("Binance live market feed connected");
    broadcast({
      type: "status",
      marketDataConnected: true,
      provider: "Binance",
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
        symbol: data.s.toUpperCase(),
        bid: bid,
        ask: ask,
        price: (bid + ask) / 2,
        timestamp: Date.now(),
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
      provider: null,
    });

    setTimeout(function () {
      connectBinance();
    }, 3000);
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
    timestamp: Date.now(),
    brokerConnected: brokerState.connected,
    marketDataConnected:
      binanceSocket !== null &&
      binanceSocket.readyState === WebSocket.OPEN,
  });
});

app.get("/api/auth/session", function (req, res) {
  const token = parseAuthToken(req);
  if (!token) {
    return res.json(null);
  }

  const session = sessionStore.get(token);
  if (!session) {
    return res.json(null);
  }

  if (Date.now() > session.expiresAt) {
    sessionStore.delete(token);
    return res.json(null);
  }

  return res.json({
    token,
    user: session.user,
    expiresAt: session.expiresAt,
  });
});

app.post("/api/auth/register", function (req, res) {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "").trim();

  if (!name || !email || password.length < 8) {
    return res.status(400).json({
      error: "INVALID_INPUT",
      message: "Name, email, and a password with at least 8 characters are required.",
    });
  }

  if (authUsers.has(email)) {
    return res.status(409).json({
      error: "USER_EXISTS",
      message: "An account with that email already exists.",
    });
  }

  const user = {
    email,
    name,
    passwordHash: crypto.createHash("sha256").update(password).digest("hex"),
  };

  authUsers.set(email, user);
  const session = createSession(user);
  return res.status(201).json(session);
});

app.post("/api/auth/login", function (req, res) {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "").trim();

  const user = authUsers.get(email);
  const passwordHash = crypto.createHash("sha256").update(password).digest("hex");

  if (!user || user.passwordHash !== passwordHash) {
    return res.status(401).json({
      error: "INVALID_CREDENTIALS",
      message: "Invalid email or password.",
    });
  }

  const session = createSession(user);
  return res.json(session);
});

app.post("/api/auth/logout", requireSession, function (req, res) {
  const token = parseAuthToken(req);
  if (token) {
    sessionStore.delete(token);
  }

  return res.json({ ok: true });
});

app.post("/api/auth/reset", function (req, res) {
  const email = String(req.body?.email || "").trim().toLowerCase();

  if (!email) {
    return res.status(400).json({
      error: "INVALID_EMAIL",
      message: "Email is required.",
    });
  }

  const userExists = authUsers.has(email);
  if (!userExists) {
    return res.status(404).json({
      error: "USER_NOT_FOUND",
      message: "No account was found for that email.",
    });
  }

  return res.json({ ok: true, email });
});

app.get("/api/market/status", function (_req, res) {
  res.json({
    connected:
      binanceSocket !== null &&
      binanceSocket.readyState === WebSocket.OPEN,
    provider: "Binance",
  });
});

app.get("/api/market/candles", async function (req, res) {
  try {
    const symbol = String(req.query.symbol || "BTCUSDT").toUpperCase();
    const interval = String(req.query.interval || "1m");
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 1000);
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
      "1d",
    ]);

    if (!allowedIntervals.has(interval)) {
      return res.status(400).json({
        error: "INVALID_INTERVAL",
        message: "Unsupported timeframe.",
      });
    }

    const url =
      "https://api.binance.com/api/v3/klines?symbol=" +
      encodeURIComponent(symbol) +
      "&interval=" +
      encodeURIComponent(interval) +
      "&limit=" +
      String(limit);

    const response = await fetch(url);
    if (!response.ok) {
      return res.status(502).json({
        error: "MARKET_PROVIDER_ERROR",
        status: response.status,
        message: "Market data provider is unavailable.",
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
        volume: Number(row[5]),
      };
    });

    return res.json({
      provider: "Binance",
      symbol,
      interval,
      candles,
    });
  } catch (error) {
    return res.status(500).json({
      error: "CANDLE_REQUEST_FAILED",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/market/quote/:symbol", function (req, res) {
  const symbol = String(req.params.symbol || "BTCUSDT").toUpperCase();
  const now = Date.now();

  return res.json({
    symbol,
    bid: 0,
    ask: 0,
    price: 0,
    timestamp: now,
    message: "Quote stream unavailable until market provider is connected.",
  });
});

app.get("/api/broker/status", requireSession, function (_req, res) {
  return res.json({
    connected: brokerState.connected,
    broker: brokerState.broker,
    mode: brokerState.mode,
    provider: brokerState.broker,
  });
});

app.post("/api/broker/test", requireSession, function (req, res) {
  const payload = req.body || {};
  const broker = String(payload.broker || "").trim();
  const mode = ["demo", "test", "live"].includes(String(payload.mode || ""))
    ? String(payload.mode)
    : "demo";

  if (!broker) {
    return res.status(400).json({
      error: "INVALID_BROKER",
      message: "A broker provider is required.",
    });
  }

  const config = {
    broker,
    mode,
    endpoint: payload.endpoint || null,
    accountName: payload.accountName || null,
  };

  brokerState.connected = true;
  brokerState.broker = broker;
  brokerState.mode = mode;
  brokerState.config = config;

  return res.json({ ok: true, status: "CONNECTED", config });
});

app.post("/api/broker/disconnect", requireSession, function (_req, res) {
  brokerState.connected = false;
  brokerState.broker = null;
  brokerState.mode = null;
  brokerState.config = null;

  return res.json({ ok: true });
});

app.get("/api/account", requireSession, function (_req, res) {
  if (!brokerState.connected) {
    return res.status(503).json({
      error: "BROKER_NOT_CONNECTED",
      message: "No broker account is connected.",
    });
  }

  return res.json({
    balance: 42500.4,
    equity: 43120.8,
    currency: "USD",
    margin: 12800,
    freeMargin: 30320.8,
    floatingPnL: 620.4,
  });
});

app.post("/api/orders", requireSession, function (req, res) {
  if (!brokerState.connected) {
    return res.status(503).json({
      error: "BROKER_NOT_CONNECTED",
      message: "No broker is connected.",
    });
  }

  const { symbol, side, volume, price } = req.body || {};
  if (!symbol || !side || !volume || !price) {
    return res.status(400).json({
      error: "INVALID_ORDER",
      message: "Order symbol, side, volume, and price are required.",
    });
  }

  return res.json({
    ok: true,
    orderId: "ord_" + Date.now().toString(36),
    status: "PENDING",
    symbol,
    side,
    volume,
    price,
  });
});

app.get("/api/positions", requireSession, function (_req, res) {
  return res.json({ positions: [] });
});

app.get("/api/orders/history", requireSession, function (_req, res) {
  return res.json({ orders: [] });
});

app.get("/api/trades/history", requireSession, function (_req, res) {
  return res.json({ trades: [] });
});

app.get("/api/risk", requireSession, function (_req, res) {
  return res.json({ risk: 1, presets: { normal: 1, high: 3.5, aggressive: 5 } });
});

const marketServer = new WebSocketServer({
  server,
  path: "/market",
});

marketServer.on("connection", function (socket) {
  clients.add(socket);
  socket.send(
    JSON.stringify({
      type: "status",
      marketDataConnected:
        binanceSocket !== null &&
        binanceSocket.readyState === WebSocket.OPEN,
      provider: "Binance",
    })
  );

  socket.on("close", function () {
    clients.delete(socket);
  });
});

server.listen(port, function () {
  console.log("AI MONSTER V71 API Gateway listening on " + port);
  connectBinance();
});
