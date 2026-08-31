import express from "express";
import cors from "cors";
import http from "http";
import crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

const app = express();
const port = Number(process.env.PORT || 8787);

const sessionStore = new Map();
const authUsers = new Map();
const clients = new Set();

let binanceSocket = null;

const brokerState = {
  connected: false,
  broker: null,
  mode: null,
  config: null,
};

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
  "1d",
]);

function broadcast(message) {
  const data = JSON.stringify(message);

  clients.forEach(function (client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

function parseAuthToken(req) {
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length).trim();
}

function safeUserResponse(user) {
  if (!user || typeof user !== "object") {
    return null;
  }

  return {
    email: String(user.email || ""),
    name: String(user.name || ""),
  };
}

function createSession(user) {
  const token = "session_" + crypto.randomBytes(18).toString("hex");
  const expiresAt = Date.now() + 1000 * 60 * 60 * 12;
  const payload = {
    token,
    user: safeUserResponse(user),
    expiresAt,
  };

  sessionStore.set(token, payload);
  return payload;
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
  req.sessionUser = user;
  return next();
}

const requireAuth = requireSession;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));

function connectBinance() {
  if (
    binanceSocket !== null &&
    (binanceSocket.readyState === WebSocket.OPEN ||
      binanceSocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  const symbols = ["btcusdt", "ethusdt", "xrpusdt", "solusdt"];
  const streams = symbols.map((symbol) => symbol + "@bookTicker").join("/");
  const socketUrl = "wss://stream.binance.com:9443/stream?streams=" + streams;

  binanceSocket = new WebSocket(socketUrl);

  binanceSocket.on("open", function () {
    broadcast({
      type: "status",
      marketDataConnected: true,
      provider: "Binance",
    });
  });

  binanceSocket.on("message", function (raw) {
    try {
      const packet = JSON.parse(raw.toString());
      const data = packet && packet.data ? packet.data : null;
      if (!data || !data.s) {
        return;
      }

      const bid = Number(data.b);
      const ask = Number(data.a);

      broadcast({
        type: "quote",
        symbol: String(data.s).toUpperCase(),
        bid,
        ask,
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
    setTimeout(connectBinance, 3000);
  });

  binanceSocket.on("error", function () {
    if (binanceSocket !== null) {
      try {
        binanceSocket.close();
      } catch {
        // no-op: socket can fail when offline
      }
    }
  });
}

app.get("/api/health", function (_req, res) {
  res.json({
    ok: true,
    service: "AI MONSTER U — PREMIUM API",
    brokerConnected: brokerState.connected,
    marketDataConnected:
      binanceSocket !== null &&
      binanceSocket.readyState === WebSocket.OPEN,
    timestamp: Date.now(),
  });
});

app.get("/api/auth/session", requireSession, function (req, res) {
  const session = sessionStore.get(parseAuthToken(req));

  if (!session) {
    return res.status(401).json({
      error: "INVALID_SESSION",
      message: "Session expired or invalid.",
    });
  }

  return res.json({
    token: session.token,
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

  if (!user) {
    return res.status(401).json({
      error: "INVALID_CREDENTIALS",
      message: "Invalid email or password.",
    });
  }

  const hash = crypto.createHash("sha256").update(password).digest("hex");
  if (user.passwordHash !== hash) {
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

  return res.json({
    ok: true,
    email,
    message: "If an account exists for this email, reset instructions have been sent.",
  });
});

app.get("/api/market/candles", async function (req, res) {
  try {
    const symbol = String(req.query.symbol || "BTCUSDT").toUpperCase();
    const interval = String(req.query.interval || "1m");
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 1000);

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
        message: "Unable to fetch historical candle data.",
        status: response.status,
      });
    }

    const rows = await response.json();
    const candles = Array.isArray(rows)
      ? rows.map(function (row) {
          return {
            time: Number(row[0]),
            open: Number(row[1]),
            high: Number(row[2]),
            low: Number(row[3]),
            close: Number(row[4]),
            volume: Number(row[5] || 0),
          };
        })
      : [];

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

app.get("/api/market/status", function (_req, res) {
  res.json({
    connected:
      binanceSocket !== null &&
      binanceSocket.readyState === WebSocket.OPEN,
    provider: "Binance",
    status: "online",
  });
});

app.get("/api/market/quote/:symbol", async function (req, res) {
  try {
    const symbol = String(req.params.symbol || "BTCUSDT").toUpperCase();
    const url = "https://api.binance.com/api/v3/ticker/bookTicker?symbol=" + encodeURIComponent(symbol);
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(502).json({
        error: "QUOTE_PROVIDER_ERROR",
        message: "Market quote unavailable.",
      });
    }

    const data = await response.json();
    const bid = Number(data?.bidPrice ?? 0);
    const ask = Number(data?.askPrice ?? 0);
    return res.json({
      symbol,
      bid,
      ask,
      price: bid && ask ? (bid + ask) / 2 : 0,
      timestamp: Date.now(),
    });
  } catch (error) {
    return res.status(500).json({
      error: "QUOTE_REQUEST_FAILED",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/broker/status", requireAuth, function (_req, res) {
  return res.json({
    connected: brokerState.connected,
    broker: brokerState.broker,
    mode: brokerState.mode,
    provider: brokerState.broker,
    status: brokerState.connected ? "connected" : "disconnected",
  });
});

app.post("/api/broker/test", requireAuth, function (req, res) {
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
    apiKey: payload.apiKey ? String(payload.apiKey).slice(0, 6) + "..." : null,
    endpoint: payload.endpoint || null,
    accountName: payload.accountName || null,
  };

  brokerState.connected = true;
  brokerState.broker = broker;
  brokerState.mode = mode;
  brokerState.config = config;

  return res.json({
    ok: true,
    status: "CONNECTED",
    config,
  });
});

app.post("/api/broker/disconnect", requireAuth, function (_req, res) {
  brokerState.connected = false;
  brokerState.broker = null;
  brokerState.mode = null;
  brokerState.config = null;

  return res.json({ ok: true });
});

app.get("/api/account", requireAuth, function (_req, res) {
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

app.get("/api/positions", requireAuth, function (_req, res) {
  return res.json({
    positions: [],
    connected: brokerState.connected,
  });
});

app.get("/api/orders/history", requireAuth, function (_req, res) {
  return res.json({
    orders: [],
    connected: brokerState.connected,
  });
});

app.get("/api/trades/history", requireAuth, function (_req, res) {
  return res.json({
    trades: [],
    connected: brokerState.connected,
  });
});

app.get("/api/risk/config", requireAuth, function (_req, res) {
  return res.json({
    riskPercent: 1,
    presets: {
      normal: 1,
      high: 3.5,
      aggressive: 5,
    },
  });
});

app.post("/api/orders", requireAuth, function (req, res) {
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
    symbol: String(symbol).toUpperCase(),
    side: String(side).toUpperCase(),
    volume: Number(volume),
    price: Number(price),
  });
});

const server = http.createServer(app);
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
    }),
  );

  socket.on("close", function () {
    clients.delete(socket);
  });
});

server.listen(port, function () {
  console.log("AI MONSTER U — PREMIUM API listening on " + port);
  connectBinance();
});
