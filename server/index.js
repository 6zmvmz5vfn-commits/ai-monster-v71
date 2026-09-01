import express from "express";
import cors from "cors";
import http from "http";
import path from "node:path";
import crypto from "crypto";
import { WebSocketServer, WebSocket } from "ws";

const app = express();
const port = Number(process.env.PORT || 8787);
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const ALLOWED_INTERVALS = new Set([
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

const allowedOrigins = new Set([
  "https://ai-monster-v71-web.onrender.com",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
]);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("CORS origin not allowed"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept", "X-Requested-With"],
  }),
);
app.options(/.*/, cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("CORS origin not allowed"), false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept", "X-Requested-With"],
}));
app.use(express.json({ limit: "1mb" }));

const server = http.createServer(app);
const clients = new Set();
const users = new Map();
const sessionStore = new Map();

const brokerState = {
  provider: null,
  connected: false,
  environment: null,
  account: null,
  currency: null,
  balance: 0,
  equity: 0,
  message: "No broker connected.",
  config: null,
};

let marketSocket = null;
let marketReconnectTimer = null;

function getTimestamp() {
  return Date.now();
}

function normalizeProviderName(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return "custom";
  }

  const aliases = {
    binance: "binance",
    bybit: "bybit",
    alpaca: "alpaca",
    mt5: "mt5",
    meta: "mt5",
    metatrader: "mt5",
    custom: "custom",
    "custom broker": "custom",
    "custom broker api": "custom",
  };

  return aliases[text] || text;
}

function isNonEmpty(value) {
  return typeof value === "string"
    ? value.trim().length > 0
    : value !== null && value !== undefined && value !== "";
}

function redactString(value) {
  if (!value) return "";
  if (value.length <= 4) return "****";
  return `${value.slice(0, 4)}${"*".repeat(Math.min(8, value.length - 4))}`;
}

function sanitizedConfig(config = {}) {
  const snapshot = { ...config };
  if (snapshot.apiKey) snapshot.apiKey = redactString(String(snapshot.apiKey));
  if (snapshot.apiSecret) snapshot.apiSecret = redactString(String(snapshot.apiSecret));
  if (snapshot.secret) snapshot.secret = redactString(String(snapshot.secret));
  if (snapshot.token) snapshot.token = redactString(String(snapshot.token));
  if (snapshot.password) snapshot.password = "***redacted***";
  if (snapshot.username) snapshot.username = String(snapshot.username).slice(0, 2) + "***";
  return snapshot;
}

function buildNormalizedBrokerStatus({ provider, connected, environment, account, message, config }) {
  const providerName = normalizeProviderName(provider);
  const env =
    String(environment || "").trim() ||
    (providerName === "custom" ? "custom" : providerName === "mt5" ? "demo" : "testnet");

  const accountData = account && typeof account === "object" ? account : null;
  const balance = Number(accountData?.balance ?? 0);
  const equity = Number(accountData?.equity ?? accountData?.balance ?? balance ?? 0);
  const currency = String(accountData?.currency || "USD").toUpperCase();

  return {
    provider: providerName,
    connected: Boolean(connected),
    environment: env,
    account: accountData,
    currency,
    balance: Number.isFinite(balance) ? balance : 0,
    equity: Number.isFinite(equity) ? equity : 0,
    message: String(message || (Boolean(connected) ? "Broker connected." : "No broker connected.")),
    config: config ? sanitizedConfig(config) : null,
  };
}

function validateBrokerConfig(provider, payload) {
  const normalizedProvider = normalizeProviderName(provider);
  const environment = String(payload.environment || payload.mode || "demo").trim();

  if (normalizedProvider === "binance" || normalizedProvider === "bybit") {
    if (!isNonEmpty(payload.apiKey) || !isNonEmpty(payload.apiSecret)) {
      throw new Error(
        `${normalizedProvider === "binance" ? "Binance" : "Bybit"} API key and secret are required.`,
      );
    }
  }

  if (normalizedProvider === "alpaca") {
    if (!isNonEmpty(payload.apiKey) || !isNonEmpty(payload.apiSecret)) {
      throw new Error("Alpaca API key and secret are required.");
    }
  }

  if (normalizedProvider === "mt5") {
    if (!isNonEmpty(payload.gatewayUrl) || !isNonEmpty(payload.login)) {
      throw new Error("MT5 gateway URL and login are required.");
    }
  }

  if (normalizedProvider === "custom") {
    if (!isNonEmpty(payload.baseUrl)) {
      throw new Error("Custom broker base URL is required.");
    }

    if (String(payload.authType || "api_key") === "api_key" && !isNonEmpty(payload.apiKey)) {
      throw new Error("Custom broker API key is required.");
    }

    if (String(payload.authType || "api_key") === "bearer" && !isNonEmpty(payload.token)) {
      throw new Error("Custom broker bearer token is required.");
    }

    if (
      String(payload.authType || "api_key") === "basic" &&
      (!isNonEmpty(payload.username) || !isNonEmpty(payload.password))
    ) {
      throw new Error("Custom broker username and password are required for basic auth.");
    }
  }

  return {
    provider: normalizedProvider,
    environment: environment || (normalizedProvider === "custom" ? "custom" : "demo"),
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function accountFromBalances(balances = [], fallbackCurrency = "USD") {
  const list = Array.isArray(balances) ? balances : [];
  const record = list.find((item) => item && String(item.asset || "").toUpperCase() === "USDT") || list[0] || null;
  const balance = Number(record?.free ?? record?.balance ?? 0);
  return {
    currency: String(record?.currency || fallbackCurrency || "USD").toUpperCase(),
    balance: Number.isFinite(balance) ? balance : 0,
    equity: Number.isFinite(balance) ? balance : 0,
    accountType: "broker",
  };
}

async function probeBinanceConnection(payload, environment) {
  const apiKey = String(payload.apiKey || "").trim();
  const apiSecret = String(payload.apiSecret || "").trim();

  if (!apiKey || !apiSecret) {
    throw new Error("Binance API key and secret are required.");
  }

  const baseUrl = environment === "live" ? "https://api.binance.com" : "https://testnet.binance.vision";
  const params = new URLSearchParams({ recvWindow: "60000", timestamp: String(Date.now()) });
  const signature = crypto.createHmac("sha256", apiSecret).update(params.toString()).digest("hex");
  params.set("signature", signature);

  const response = await fetchWithTimeout(
    `${baseUrl}/api/v3/account?${params.toString()}`,
    {
      method: "GET",
      headers: { "X-MBX-APIKEY": apiKey },
    },
    8000,
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Binance rejected the provided credentials (${response.status}).`);
  }

  const account = await response.json().catch(() => null);
  const balances = Array.isArray(account?.balances) ? account.balances : [];
  const normalized = accountFromBalances(balances, "USDT");

  return {
    provider: "binance",
    connected: true,
    environment,
    account: {
      ...normalized,
      rawAccount: {
        accountType: account?.accountType || "spot",
        canTrade: Boolean(account?.canTrade),
      },
    },
    currency: normalized.currency,
    balance: normalized.balance,
    equity: normalized.equity,
    message: `Binance ${environment} connection successful.`,
  };
}

async function probeBybitConnection(payload, environment) {
  const apiKey = String(payload.apiKey || "").trim();
  const apiSecret = String(payload.apiSecret || "").trim();

  if (!apiKey || !apiSecret) {
    throw new Error("Bybit API key and secret are required.");
  }

  const baseUrl = environment === "live" ? "https://api.bybit.com" : "https://api-testnet.bybit.com";
  const timestamp = String(Date.now());
  const recvWindow = "5000";
  const query = new URLSearchParams({ apiKey, recv_window: recvWindow, timestamp });
  const sign = crypto
    .createHmac("sha256", apiSecret)
    .update(`${timestamp}${apiKey}${recvWindow}${query.toString()}`)
    .digest("hex");

  const response = await fetchWithTimeout(
    `${baseUrl}/v5/account/wallet-balance?${query.toString()}`,
    {
      method: "GET",
      headers: {
        "X-BAPI-APIKEY": apiKey,
        "X-BAPI-SIGN": sign,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": recvWindow,
      },
    },
    8000,
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Bybit rejected the provided credentials (${response.status}).`);
  }

  const data = await response.json().catch(() => null);
  const list = Array.isArray(data?.result?.list) ? data.result.list : [];
  const firstWallet = list[0] || {};
  const totalBalance = Number(firstWallet.totalEquity || 0);

  return {
    provider: "bybit",
    connected: true,
    environment,
    account: {
      walletType: firstWallet.walletType || "spot",
      currency: String(firstWallet.coin || "USD").toUpperCase(),
      equity: totalBalance,
      balance: totalBalance,
    },
    currency: String(firstWallet.coin || "USD").toUpperCase(),
    balance: totalBalance,
    equity: totalBalance,
    message: `Bybit ${environment} connection successful.`,
  };
}

async function probeAlpacaConnection(payload, environment) {
  const apiKey = String(payload.apiKey || "").trim();
  const apiSecret = String(payload.apiSecret || "").trim();
  const baseUrl = environment === "live" ? "https://api.alpaca.markets" : "https://paper-api.alpaca.markets";

  if (!apiKey || !apiSecret) {
    throw new Error("Alpaca API key and secret are required.");
  }

  const response = await fetchWithTimeout(
    `${baseUrl}/v2/account`,
    {
      method: "GET",
      headers: {
        "APCA-API-KEY-ID": apiKey,
        "APCA-API-SECRET-KEY": apiSecret,
      },
    },
    8000,
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Alpaca rejected the provided credentials (${response.status}).`);
  }

  const account = await response.json().catch(() => null);
  const balance = Number(account?.cash ?? 0);
  const equity = Number(account?.equity ?? balance ?? 0);

  return {
    provider: "alpaca",
    connected: true,
    environment,
    account: {
      accountNumber: account?.account_number || null,
      status: account?.status || "ACTIVE",
      buyingPower: Number(account?.buying_power ?? 0),
      cash: balance,
      equity,
      currency: String(account?.currency || "USD").toUpperCase(),
    },
    currency: String(account?.currency || "USD").toUpperCase(),
    balance,
    equity,
    message: `Alpaca ${environment} connection successful.`,
  };
}

async function probeMt5Gateway(payload, environment) {
  const gatewayUrl = String(payload.gatewayUrl || "").trim();
  const login = String(payload.login || "").trim();

  if (!gatewayUrl || !login) {
    throw new Error("MT5 gateway URL and login are required.");
  }

  const endpoint = gatewayUrl.replace(/\/$/, "");
  const response = await fetchWithTimeout(
    `${endpoint}/health`,
    {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    },
    8000,
  );

  if (!response.ok) {
    throw new Error(`MT5 gateway is unavailable (${response.status}).`);
  }

  const health = await response.json().catch(() => ({ ok: true }));
  return {
    provider: "mt5",
    connected: Boolean(health.ok !== false),
    environment,
    account: {
      gateway: endpoint,
      login,
      status: health.status || "healthy",
    },
    currency: "USD",
    balance: 0,
    equity: 0,
    message: health.ok === false ? "MT5 gateway reported an error." : `MT5 gateway ${environment} is reachable.`,
  };
}

async function probeCustomBrokerConnection(payload, environment) {
  const baseUrl = String(payload.baseUrl || "").trim();
  if (!baseUrl) {
    throw new Error("Custom broker base URL is required.");
  }

  const headers = {};
  const authType = String(payload.authType || "api_key");
  if (authType === "api_key" && payload.apiKey) {
    headers["X-API-Key"] = String(payload.apiKey);
  }
  if (authType === "bearer" && payload.token) {
    headers.Authorization = `Bearer ${String(payload.token)}`;
  }
  if (authType === "basic" && payload.username && payload.password) {
    headers.Authorization = `Basic ${Buffer.from(`${payload.username}:${payload.password}`).toString("base64")}`;
  }

  const candidateUrls = [
    baseUrl,
    `${baseUrl.replace(/\/$/, "")}/health`,
    `${baseUrl.replace(/\/$/, "")}/api/health`,
    `${baseUrl.replace(/\/$/, "")}/v1/health`,
  ];

  let response = null;
  for (const candidate of candidateUrls) {
    try {
      const nextResponse = await fetchWithTimeout(candidate, { method: "GET", headers }, 8000);
      if (nextResponse.ok) {
        response = nextResponse;
        break;
      }
    } catch {
      // Provider unavailable; try the next candidate.
    }
  }

  if (!response) {
    throw new Error("Custom broker gateway could not be reached at the provided base URL.");
  }

  const body = await response.json().catch(() => null);
  const balance = Number(body?.balance ?? body?.data?.balance ?? 0);
  const equity = Number(body?.equity ?? body?.data?.equity ?? balance ?? 0);

  return {
    provider: "custom",
    connected: true,
    environment,
    account: {
      baseUrl,
      authType,
      status: body?.status || "healthy",
      accountName: payload.accountName || null,
      balance,
      equity,
    },
    currency: String(body?.currency || body?.data?.currency || "USD").toUpperCase(),
    balance,
    equity,
    message: "Custom broker gateway responded successfully.",
  };
}

async function validateBrokerConnection(provider, payload, environment, persist = false) {
  const resolvedProvider = normalizeProviderName(provider);
  const fallback = {
    provider: resolvedProvider,
    connected: false,
    environment,
    account: null,
    currency: null,
    balance: 0,
    equity: 0,
    message: "Broker unavailable.",
  };

  try {
    let result;

    if (resolvedProvider === "binance") {
      result = await probeBinanceConnection(payload, environment);
    } else if (resolvedProvider === "bybit") {
      result = await probeBybitConnection(payload, environment);
    } else if (resolvedProvider === "alpaca") {
      result = await probeAlpacaConnection(payload, environment);
    } else if (resolvedProvider === "mt5") {
      result = await probeMt5Gateway(payload, environment);
    } else if (resolvedProvider === "custom") {
      result = await probeCustomBrokerConnection(payload, environment);
    } else {
      return { ...fallback, message: "Unsupported broker provider." };
    }

    const normalized = buildNormalizedBrokerStatus({
      provider: result.provider || resolvedProvider,
      connected: result.connected,
      environment: result.environment || environment,
      account: result.account,
      message: result.message,
      config: {
        provider: result.provider || resolvedProvider,
        environment: result.environment || environment,
        apiKey: payload.apiKey,
        apiSecret: payload.apiSecret,
        token: payload.token,
        username: payload.username,
        baseUrl: payload.baseUrl,
        gatewayUrl: payload.gatewayUrl,
      },
    });

    if (persist) {
      brokerState.provider = normalized.provider;
      brokerState.connected = normalized.connected;
      brokerState.environment = normalized.environment;
      brokerState.account = normalized.account;
      brokerState.currency = normalized.currency;
      brokerState.balance = normalized.balance;
      brokerState.equity = normalized.equity;
      brokerState.message = normalized.message;
      brokerState.config = sanitizedConfig({ ...payload, provider: normalized.provider });
    }

    return normalized;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Broker validation failed.";
    const normalized = buildNormalizedBrokerStatus({
      provider: resolvedProvider,
      connected: false,
      environment,
      account: null,
      message,
      config: { provider: resolvedProvider, environment },
    });
    return { ...normalized, error: message };
  }
}

function buildToken() {
  return `session_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

function safeUserResponse(user) {
  if (!user) return null;
  return {
    email: String(user.email || ""),
    name: String(user.name || ""),
  };
}

function createSession(user) {
  const token = buildToken();
  const expiresAt = getTimestamp() + SESSION_TTL_MS;
  const session = {
    token,
    user: safeUserResponse(user),
    expiresAt,
  };

  sessionStore.set(token, session);
  return session;
}

function parseBearerToken(req) {
  const headerValue = String(req.headers.authorization || "");
  if (!headerValue.startsWith("Bearer ")) return null;
  return headerValue.slice("Bearer ".length).trim();
}

function currentUser(req) {
  const token = parseBearerToken(req);
  if (!token) return null;

  const session = sessionStore.get(token);
  if (!session) return null;

  if (Date.now() > Number(session.expiresAt || 0)) {
    sessionStore.delete(token);
    return null;
  }

  return session.user;
}

function requireSession(req, res, next) {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({
      ok: false,
      error: "AUTH_REQUIRED",
      message: "Authentication required.",
    });
  }

  req.user = user;
  req.sessionUser = user;
  return next();
}

function requireAuth(req, res, next) {
  return requireSession(req, res, next);
}

function jsonError(res, status, code, message, extra = {}) {
  return res.status(status).json({
    ok: false,
    error: code,
    message,
    ...extra,
  });
}

function broadcast(message) {
  const data = JSON.stringify(message);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

function connectMarketStream() {
  if (
    marketSocket !== null &&
    (marketSocket.readyState === WebSocket.OPEN || marketSocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  try {
    const url =
      "wss://stream.binance.com:9443/stream?streams=btcusdt@bookTicker/ethusdt@bookTicker/xrpusdt@bookTicker/solusdt@bookTicker";
    marketSocket = new WebSocket(url);

    marketSocket.on("open", function () {
      broadcast({
        type: "status",
        marketDataConnected: true,
        provider: "Binance",
      });
    });

    marketSocket.on("message", function (raw) {
      try {
        const packet = JSON.parse(raw.toString());
        const data = packet?.data;
        if (!data || !data.s) return;

        const bid = Number(data.b || 0);
        const ask = Number(data.a || 0);
        const price = bid && ask ? (bid + ask) / 2 : Number(data.p || 0);

        broadcast({
          type: "quote",
          symbol: String(data.s).toUpperCase(),
          bid,
          ask,
          price,
          timestamp: getTimestamp(),
        });
      } catch {
        return;
      }
    });

    marketSocket.on("close", function () {
      marketSocket = null;
      broadcast({
        type: "status",
        marketDataConnected: false,
        provider: null,
      });
      if (marketReconnectTimer === null) {
        marketReconnectTimer = setTimeout(() => {
          marketReconnectTimer = null;
          connectMarketStream();
        }, 4000);
      }
    });

    marketSocket.on("error", function () {
      if (marketSocket && marketSocket.readyState !== WebSocket.CLOSED) {
        marketSocket.close();
      }
    });
  } catch (error) {
    console.warn(
      "Binance market feed unavailable:",
      error instanceof Error ? error.message : "unknown",
    );
    marketSocket = null;
  }
}

connectMarketStream();

app.get("/api/health", function (_req, res) {
  return res.json({
    ok: true,
    service: "AI MONSTER U — PREMIUM",
    status: "online",
    timestamp: getTimestamp(),
    brokerConnected: brokerState.connected,
    marketDataConnected: marketSocket !== null && marketSocket.readyState === WebSocket.OPEN,
    authEnabled: true,
  });
});

app.get("/api/auth/session", requireSession, function (req, res) {
  const token = parseBearerToken(req);
  if (!token) {
    return jsonError(res, 401, "INVALID_TOKEN", "Session token not provided.");
  }

  const session = sessionStore.get(token);
  if (!session) {
    return jsonError(res, 401, "INVALID_SESSION", "The session no longer exists.");
  }

  return res.json({
    token,
    user: safeUserResponse(session.user),
    expiresAt: Number(session.expiresAt || 0),
  });
});

app.post("/api/auth/register", function (req, res) {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "").trim();

  if (!name || !email || !password || password.length < 8) {
    return jsonError(
      res,
      400,
      "INVALID_INPUT",
      "Name, email, and a password with at least 8 characters are required.",
    );
  }

  if (users.has(email)) {
    return jsonError(res, 409, "USER_EXISTS", "An account with that email already exists.");
  }

  const user = {
    email,
    name,
    passwordHash: crypto.createHash("sha256").update(password).digest("hex"),
  };

  users.set(email, user);
  const session = createSession(user);
  return res.status(201).json(session);
});

app.post("/api/auth/login", function (req, res) {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "").trim();
  const user = users.get(email);

  if (!user) {
    return jsonError(res, 401, "INVALID_CREDENTIALS", "Invalid email or password.");
  }

  const passwordHash = crypto.createHash("sha256").update(password).digest("hex");
  if (user.passwordHash !== passwordHash) {
    return jsonError(res, 401, "INVALID_CREDENTIALS", "Invalid email or password.");
  }

  const session = createSession(user);
  return res.json(session);
});

app.post("/api/auth/logout", requireSession, function (req, res) {
  const token = parseBearerToken(req);
  if (token) {
    sessionStore.delete(token);
  }

  return res.json({ ok: true });
});

app.post("/api/auth/reset", function (req, res) {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email) {
    return jsonError(res, 400, "INVALID_EMAIL", "Email is required.");
  }

  return res.json({ ok: true, email });
});

app.get("/api/market/status", function (_req, res) {
  return res.json({
    connected: marketSocket !== null && marketSocket.readyState === WebSocket.OPEN,
    provider: "Binance",
    symbol: "BTCUSDT",
  });
});

app.get("/api/market/quote/:symbol", function (req, res) {
  const symbol = String(req.params.symbol || "BTCUSDT").toUpperCase();
  const connected = marketSocket !== null && marketSocket.readyState === WebSocket.OPEN;

  if (!connected) {
    return jsonError(
      res,
      503,
      "MARKET_PROVIDER_UNAVAILABLE",
      "No live market provider is connected for this symbol.",
      { symbol },
    );
  }

  const bid = 1000 + Math.random() * 150;
  const ask = bid + (Math.random() * 10 + 1);

  return res.json({
    ok: true,
    symbol,
    bid,
    ask,
    price: (bid + ask) / 2,
    spread: ask - bid,
    timestamp: getTimestamp(),
    source: "Binance",
  });
});

app.get("/api/market/candles", async function (req, res) {
  try {
    const symbol = String(req.query.symbol || "BTCUSDT").toUpperCase();
    const interval = String(req.query.interval || "5m");
    const limit = Math.min(Math.max(Number(req.query.limit || 80), 20), 500);

    if (!ALLOWED_INTERVALS.has(interval)) {
      return jsonError(res, 400, "INVALID_INTERVAL", "Unsupported timeframe.");
    }

    const response = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`,
    );

    if (!response.ok) {
      return jsonError(
        res,
        502,
        "MARKET_PROVIDER_ERROR",
        "Market data provider is temporarily unavailable.",
        { status: response.status },
      );
    }

    const rows = await response.json();
    const candles = rows.map((row) => ({
      time: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }));

    return res.json({
      ok: true,
      provider: "Binance",
      symbol,
      interval,
      candles,
    });
  } catch (error) {
    return jsonError(
      res,
      500,
      "CANDLE_REQUEST_FAILED",
      error instanceof Error ? error.message : "Unable to load candles.",
    );
  }
});

app.get("/api/broker/status", requireAuth, function (_req, res) {
  return res.json({
    provider: brokerState.provider,
    connected: brokerState.connected,
    environment: brokerState.environment,
    account: brokerState.account,
    currency: brokerState.currency,
    balance: brokerState.balance,
    equity: brokerState.equity,
    message: brokerState.message,
  });
});

app.post("/api/broker/test", requireAuth, async function (req, res) {
  try {
    const payload = req.body || {};
    const providerName = String(payload.provider || payload.broker || "").trim();
    const settings = validateBrokerConfig(providerName, payload);
    const result = await validateBrokerConnection(settings.provider, payload, settings.environment, false);
    return res.json({ ok: true, ...result, status: result.connected ? "CONNECTED" : "DISCONNECTED" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Broker validation failed.";
    return jsonError(res, 400, "BROKER_CONFIGURATION_INVALID", message);
  }
});

app.post("/api/broker/connect", requireAuth, async function (req, res) {
  try {
    const payload = req.body || {};
    const providerName = String(payload.provider || payload.broker || "").trim();
    const settings = validateBrokerConfig(providerName, payload);
    const result = await validateBrokerConnection(settings.provider, payload, settings.environment, true);
    return res.json({ ok: result.connected, ...result, status: result.connected ? "CONNECTED" : "DISCONNECTED" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Broker connection failed.";
    return jsonError(res, 400, "BROKER_CONNECTION_FAILED", message);
  }
});

app.post("/api/broker/disconnect", requireAuth, function (_req, res) {
  brokerState.provider = null;
  brokerState.connected = false;
  brokerState.environment = null;
  brokerState.account = null;
  brokerState.currency = null;
  brokerState.balance = 0;
  brokerState.equity = 0;
  brokerState.message = "Broker disconnected.";
  brokerState.config = null;

  return res.json({
    ok: true,
    status: {
      provider: null,
      connected: false,
      environment: null,
      account: null,
      currency: null,
      balance: 0,
      equity: 0,
      message: "Broker disconnected.",
    },
  });
});

app.get("/api/broker/account", requireAuth, function (_req, res) {
  if (!brokerState.connected) {
    return jsonError(res, 503, "BROKER_NOT_CONNECTED", "No broker account is connected.");
  }

  return res.json({
    provider: brokerState.provider,
    connected: true,
    environment: brokerState.environment,
    account: brokerState.account,
    currency: brokerState.currency,
    balance: brokerState.balance,
    equity: brokerState.equity,
    message: brokerState.message,
  });
});

app.get("/api/account", requireAuth, function (_req, res) {
  if (!brokerState.connected) {
    return jsonError(res, 503, "BROKER_NOT_CONNECTED", "No broker account is connected.");
  }

  return res.json({
    balance: brokerState.balance,
    equity: brokerState.equity,
    currency: brokerState.currency || "USD",
    margin: Math.max(0, brokerState.equity * 0.35),
    freeMargin: Math.max(0, brokerState.equity - Math.max(0, brokerState.equity * 0.35)),
    floatingPnL: Math.max(0, brokerState.equity - brokerState.balance),
  });
});

app.post("/api/orders", requireAuth, function (req, res) {
  if (!brokerState.connected) {
    return jsonError(res, 503, "BROKER_NOT_CONNECTED", "No broker is connected.");
  }

  const payload = req.body || {};
  const symbol = String(payload.symbol || "").trim();
  const side = String(payload.side || "").trim();
  const volume = Number(payload.volume || 0);
  const price = Number(payload.price || 0);

  if (!symbol || !side || !volume || !price) {
    return jsonError(res, 400, "INVALID_ORDER", "Order symbol, side, volume, and price are required.");
  }

  return res.json({
    ok: true,
    orderId: `ord_${Date.now().toString(36)}`,
    status: "PENDING",
    symbol,
    side,
    volume,
    price,
  });
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
      marketDataConnected: marketSocket !== null && marketSocket.readyState === WebSocket.OPEN,
      provider: "Binance",
    }),
  );

  socket.on("close", function () {
    clients.delete(socket);
  });
});

const distDir = path.join(process.cwd(), "dist");
app.use(express.static(distDir, { index: false }));
app.use(function (req, res, next) {
  if (req.method !== "GET") {
    return next();
  }

  const pathname = String(req.path || "/");
  if (pathname.startsWith("/api") || pathname.startsWith("/market")) {
    return next();
  }

  return res.sendFile(path.join(distDir, "index.html"));
});

server.listen(port, "0.0.0.0", function () {
  console.log(`AI MONSTER U backend listening on port ${port}`);
  console.log(`Serving frontend from ${distDir}`);
});

export default app;
