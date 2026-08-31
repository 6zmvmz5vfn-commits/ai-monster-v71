import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { loadHistoricalCandles } from "./services/marketHistory";
import BrokerCenter from "./components/BrokerCenter";
import {
  getAccount,
  getGatewayHealth,
  getAuthSession,
  loginUser,
  logoutUser,
  registerUser,
  resetPassword,
  type SessionResponse,
} from "./services/api";
import type { LiveCandle } from "./services/candleStore";
import { subscribeLiveQuote } from "./services/marketSocket";

type Nav =
  | "command"
  | "markets"
  | "trading"
  | "positions"
  | "orders"
  | "history"
  | "accounts"
  | "settings"
  | "admin";

type AuthMode = "login" | "register" | "reset";

type SymbolItem = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  spread: number;
};

type Position = {
  symbol: string;
  side: "BUY" | "SELL";
  volume: number;
  entry: number;
  sl: number;
  pnl: number;
};

type OrderRecord = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: string;
  status: "PENDING" | "FILLED" | "REJECTED";
  volume: number;
  price: number;
  createdAt: string;
};

type HistoryItem = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  pnl: number;
  result: string;
  time: string;
};

type AccountRecord = {
  id: string;
  name: string;
  broker: string;
  mode: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  connected: boolean;
};

const FALLBACK_SYMBOL: SymbolItem = {
  symbol: "BTCUSDT",
  name: "Bitcoin / Tether",
  price: 0,
  change: 0,
  spread: 0,
};

const RISK_PRESETS = [
  { label: "Conservative", value: "0.5" },
  { label: "Balanced", value: "1.0" },
  { label: "Aggressive", value: "2.0" },
  { label: "Max", value: "5.0" },
];

function App() {
  const [activeNav, setActiveNav] = useState<Nav>("command");
  const [symbols, setSymbols] = useState<SymbolItem[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState("5m");
  const [risk, setRisk] = useState("1.0");
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [search, setSearch] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [gatewayOnline, setGatewayOnline] = useState(false);
  const [marketDataConnected, setMarketDataConnected] = useState(false);
  const [accountBalance, setAccountBalance] = useState<number | null>(null);
  const [accountEquity, setAccountEquity] = useState<number | null>(null);
  const [accountCurrency, setAccountCurrency] = useState("USD");
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [authMessage, setAuthMessage] = useState("");
  const [authError, setAuthError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selected = useMemo(
    () => symbols.find((item) => item.symbol === selectedSymbol) ?? symbols[0] ?? FALLBACK_SYMBOL,
    [symbols, selectedSymbol],
  );

  const aiFlags = useMemo(() => {
    const value = Number(risk) || 1;
    const trend = selected.price >= 1000 ? "Bullish" : "Bearish";
    return {
      trend,
      momentum: value > 2 ? "Strong" : value > 1 ? "Moderate" : "Measured",
      volatility: selected.spread > 0.5 ? "Elevated" : "Contained",
      structure: selected.symbol.includes("USD") ? "Range" : "Trend",
      confidence: value > 1 ? "High" : "Balanced",
      support: (selected.price * 0.99).toFixed(2),
      resistance: (selected.price * 1.01).toFixed(2),
    };
  }, [risk, selected]);

  const estimatedLot = useMemo(() => {
    if (accountBalance === null) return 0;
    const riskMoney = accountBalance * (Number(risk) / 100);
    const stopDistance = selected.symbol === "XAUUSD" ? 2.0 : 0.002;
    const raw = riskMoney / Math.max(stopDistance * 100, 1);
    return Math.min(5, Number(raw.toFixed(2)));
  }, [accountBalance, risk, selected]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const cached = window.localStorage.getItem("ai-monster-session");
    if (!cached) return;

    try {
      const parsed = JSON.parse(cached) as SessionResponse | null;
      if (parsed?.token && parsed?.user) {
        setSession(parsed);
      }
    } catch {
      window.localStorage.removeItem("ai-monster-session");
    }
  }, []);

  useEffect(() => {
    if (!session) {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("ai-monster-session");
      }
      return;
    }

    if (typeof window !== "undefined") {
      window.localStorage.setItem("ai-monster-session", JSON.stringify(session));
    }
  }, [session]);

  useEffect(() => {
    if (!session?.token) {
      return;
    }

    void getAuthSession()
      .then((nextSession) => {
        if (nextSession) {
          setSession(nextSession);
        }
      })
      .catch(() => {
        setSession(null);
      });
  }, [session?.token]);

  useEffect(() => {
    const unsubscribe = subscribeLiveQuote((quote) => {
      const symbol = String(quote.symbol).toUpperCase();
      setSymbols((current) => {
        const normalized = {
          symbol,
          name: symbol.includes("USDT") ? symbol.replace(/USDT$/, " / Tether") : symbol,
          price: Number(quote.price),
          change: 0,
          spread: Number(Math.max((quote.ask - quote.bid) * 100, 0).toFixed(2)),
        };

        const existing = current.find((item) => item.symbol === symbol);
        if (!existing) {
          return [normalized, ...current].slice(0, 12);
        }

        return current.map((item) =>
          item.symbol === symbol ? { ...item, ...normalized } : item,
        );
      });
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const checkGateway = async () => {
      try {
        const health = await getGatewayHealth();
        if (cancelled) return;

        setGatewayOnline(health.ok);
        setMarketDataConnected(health.marketDataConnected);

        try {
          const account = await getAccount();
          if (!cancelled) {
            setAccountBalance(account.balance);
            setAccountEquity(account.equity);
            setAccountCurrency(account.currency);
          }
        } catch {
          if (!cancelled) {
            setAccountBalance(null);
            setAccountEquity(null);
          }
        }
      } catch {
        if (!cancelled) {
          setGatewayOnline(false);
          setMarketDataConnected(false);
        }
      }
    };

    void checkGateway();
    const statusTimer = window.setInterval(checkGateway, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(statusTimer);
    };
  }, []);

  const filteredSymbols = symbols.filter(
    (item) =>
      item.symbol.toLowerCase().includes(search.toLowerCase()) ||
      item.name.toLowerCase().includes(search.toLowerCase()),
  );

  async function handleAuthSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    setAuthMessage("");
    setIsSubmitting(true);

    try {
      if (authMode === "register") {
        const response = await registerUser({
          name: authForm.name,
          email: authForm.email,
          password: authForm.password,
        });
        setSession(response);
        setAuthMessage("Account created successfully.");
      } else if (authMode === "login") {
        const response = await loginUser({
          email: authForm.email,
          password: authForm.password,
        });
        setSession(response);
        setAuthMessage("Welcome back.");
      } else {
        await resetPassword(authForm.email);
        setAuthMessage("Password reset instructions have been sent to your email.");
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogout() {
    try {
      await logoutUser();
    } catch {
      // Ignore and clear local session.
    } finally {
      setSession(null);
      setAuthForm({ name: "", email: "", password: "" });
      setAuthMode("login");
    }
  }

  if (!session) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-header">
            <div className="brand-mark large">M</div>
            <div>
              <div className="brand-name">AI MONSTER</div>
              <div className="brand-version">U • PREMIUM</div>
            </div>
          </div>

          <div className="auth-toggle">
            <button className={authMode === "login" ? "selected" : ""} onClick={() => setAuthMode("login")}>Login</button>
            <button className={authMode === "register" ? "selected" : ""} onClick={() => setAuthMode("register")}>Create Account</button>
            <button className={authMode === "reset" ? "selected" : ""} onClick={() => setAuthMode("reset")}>Reset Password</button>
          </div>

          <form className="auth-form" onSubmit={handleAuthSubmit}>
            {authMode === "register" && (
              <label>
                Full name
                <input
                  value={authForm.name}
                  onChange={(event) => setAuthForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Alex Morgan"
                />
              </label>
            )}

            <label>
              Email
              <input
                type="email"
                value={authForm.email}
                onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="you@example.com"
              />
            </label>

            {authMode !== "reset" && (
              <label>
                Password
                <input
                  type="password"
                  value={authForm.password}
                  onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
                  placeholder="At least 8 characters"
                />
              </label>
            )}

            {authError && <div className="auth-alert error">{authError}</div>}
            {authMessage && <div className="auth-alert success">{authMessage}</div>}

            <button type="submit" className="primary-button" disabled={isSubmitting}>
              {isSubmitting ? "Processing..." : authMode === "login" ? "Login" : authMode === "register" ? "Create Account" : "Send Reset Link"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <div className="brand-name">AI MONSTER</div>
            <div className="brand-version">U • PREMIUM</div>
          </div>
        </div>

        <div className="desktop-status">
          <span className={`status-dot ${marketDataConnected ? "ready" : "offline"}`} />
          MARKET DATA
          <strong>{marketDataConnected ? "LIVE" : "OFFLINE"}</strong>
        </div>

        <div className="header-actions">
          <span className="user-pill">{session.user.name}</span>
          <button className="ghost-button" onClick={handleLogout}>Logout</button>
          <button
            className="menu-button"
            onClick={() => setMobileMenu((value) => !value)}
            aria-label="Open menu"
          >
            ☰
          </button>
        </div>
      </header>

      {mobileMenu && (
        <div className="mobile-menu">
          {[
            ["command", "Command Center"],
            ["markets", "Markets"],
            ["trading", "Trading"],
            ["positions", "Positions"],
            ["orders", "Orders"],
            ["history", "History"],
            ["accounts", "Accounts"],
            ["settings", "Settings"],
            ["admin", "Admin"],
          ].map(([navKey, label]) => (
            <button key={navKey} onClick={() => { setActiveNav(navKey as Nav); setMobileMenu(false); }}>
              {label}
            </button>
          ))}
        </div>
      )}

      <main className="content">
        <BrokerCenter />

        <section className="hero">
          <div>
            <span className="eyebrow">COMMAND CENTER</span>
            <h1>AI MONSTER</h1>
            <p>Professional trading intelligence terminal</p>
          </div>

          <div className="account-card">
            <span>ACCOUNT EQUITY</span>
            <strong>{accountEquity === null ? "—" : `$${(accountEquity as number).toLocaleString()}`}</strong>
            <small>{accountEquity === null ? "Broker account not connected" : `${accountCurrency} live account`}</small>
          </div>
        </section>

        <section className="connection-grid">
          <ConnectionCard title="Market Data" value={marketDataConnected ? "LIVE" : "Not Connected"} detail={gatewayOnline ? "Gateway online" : "Waiting for gateway"} danger={!marketDataConnected} />
          <ConnectionCard title="Execution" value={gatewayOnline ? "READY" : "LOCKED"} detail={gatewayOnline ? "Gateway verified" : "Awaiting verification"} danger={!gatewayOnline} />
          <ConnectionCard title="AI Engine" value="READY" detail={`Trend ${aiFlags.trend} • ${aiFlags.confidence}`} />
          <ConnectionCard title="Protection" value="ARMED" detail="Trailing stop active" />
        </section>

        {activeNav === "command" && (
          <>
            <section className="metrics">
              <Metric title="Balance" value={accountBalance === null ? "—" : `$${(accountBalance as number).toLocaleString()}`} />
              <Metric title="Equity" value={accountEquity === null ? "—" : `$${(accountEquity as number).toLocaleString()}`} />
              <Metric title="Floating P/L" value="—" />
              <Metric title="Risk" value={`${risk}%`} positive />
            </section>

            <section className="main-grid">
              <MarketPanel symbols={filteredSymbols} selected={selectedSymbol} onSelect={setSelectedSymbol} search={search} onSearch={setSearch} />
              <ChartPanel symbol={selected} timeframe={timeframe} setTimeframe={setTimeframe} />
              <AIPanel risk={risk} setRisk={setRisk} lot={estimatedLot} />
            </section>

            <PositionsPanel positions={positions} />
          </>
        )}

        {activeNav === "markets" && (
          <section className="full-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">MARKET DISCOVERY</span>
                <h2>Markets</h2>
              </div>
              <span className="connection-pill"><span className="status-dot offline" /> Feed {marketDataConnected ? "live" : "offline"}</span>
            </div>

            <input className="search" placeholder="Search symbols..." value={search} onChange={(event) => setSearch(event.target.value)} />

            <div className="market-list">
              {filteredSymbols.map((item) => (
                <button className="market-row" key={item.symbol} onClick={() => { setSelectedSymbol(item.symbol); setActiveNav("command"); }}>
                  <div>
                    <strong>{item.symbol}</strong>
                    <small>{item.name}</small>
                  </div>
                  <strong>{item.price.toLocaleString()}</strong>
                  <span className={item.change >= 0 ? "positive" : "negative"}>{item.change >= 0 ? "+" : ""}{item.change}%</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {activeNav === "trading" && (
          <section className="trading-screen">
            <div className="panel-header">
              <div>
                <span className="eyebrow">EXECUTION CENTER</span>
                <h2>AI MONSTER Trading</h2>
              </div>
              <span className="locked-badge">{gatewayOnline ? "LIVE READY" : "EXECUTION LOCKED"}</span>
            </div>

            <div className="trade-symbol">
              <div>
                <span>{selected.symbol}</span>
                <strong>{selected.price.toLocaleString()}</strong>
              </div>
              <span className={gatewayOnline ? "positive" : "offline-label"}>{gatewayOnline ? "BROKER CONNECTED" : "BROKER OFFLINE"}</span>
            </div>

            <div className="risk-editor">
              <label>
                Risk per trade
                <input type="number" min="0.1" max="10" step="0.1" value={risk} onChange={(event) => setRisk(event.target.value)} />
              </label>

              <div className="calculated">
                <span>Calculated volume</span>
                <strong>{estimatedLot.toFixed(2)} lots</strong>
              </div>

              <div className="calculated">
                <span>Initial protection</span>
                <strong>{aiFlags.support}</strong>
              </div>

              <div className="calculated">
                <span>Trailing mode</span>
                <strong>0.1 step</strong>
              </div>
            </div>

            <div className="execution-buttons">
              <button type="button" disabled={!gatewayOnline}>BUY</button>
              <button type="button" disabled={!gatewayOnline}>SELL</button>
            </div>

            <div className="execution-notice">
              <span>🔒</span>
              <div>
                <strong>{gatewayOnline ? "Execution is available after verification" : "Live execution is locked"}</strong>
                <p>{gatewayOnline ? "Orders will validate broker response before acceptance." : "Connect and verify a supported broker before real orders can be submitted."}</p>
              </div>
            </div>
          </section>
        )}

        {activeNav === "positions" && (
          <section className="full-panel">
            <div className="panel-header"><div><span className="eyebrow">PORTFOLIO</span><h2>Open Positions</h2></div></div>
            <div className="position-list">
              {positions.length === 0 ? <div className="empty-state">No open positions.</div> : positions.map((position) => (
                <div className="position-row" key={`${position.symbol}-${position.entry}`}>
                  <div><strong>{position.symbol}</strong><span className="positive">{position.side}</span></div>
                  <div><span>Volume</span><strong>{position.volume.toFixed(2)}</strong></div>
                  <div><span>Entry</span><strong>{position.entry}</strong></div>
                  <div><span>SL</span><strong>{position.sl}</strong></div>
                  <div><span>P/L</span><strong className="positive">+${position.pnl.toFixed(2)}</strong></div>
                  <div className="protection-status"><span className="status-dot ready" /> Protected</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeNav === "orders" && (
          <section className="full-panel">
            <div className="panel-header"><div><span className="eyebrow">EXECUTION</span><h2>Orders</h2></div></div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Symbol</th><th>Side</th><th>Type</th><th>Status</th><th>Volume</th><th>Price</th></tr></thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id}><td>{order.symbol}</td><td>{order.side}</td><td>{order.type}</td><td>{order.status}</td><td>{order.volume}</td><td>{order.price}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeNav === "history" && (
          <section className="full-panel">
            <div className="panel-header"><div><span className="eyebrow">PERFORMANCE</span><h2>Trade History</h2></div></div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th>P/L</th><th>Result</th></tr></thead>
                <tbody>
                  {history.map((item) => (
                    <tr key={item.id}><td>{item.time}</td><td>{item.symbol}</td><td>{item.side}</td><td className={item.pnl >= 0 ? "positive" : "negative"}>{item.pnl >= 0 ? "+" : ""}${item.pnl.toFixed(2)}</td><td>{item.result}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeNav === "accounts" && (
          <section className="full-panel">
            <div className="panel-header"><div><span className="eyebrow">ACCOUNTS</span><h2>Connected Accounts</h2></div></div>
            <div className="account-grid">
              {accounts.map((account) => (
                <div className="account-tile" key={account.id}>
                  <div className="account-header"><h3>{account.name}</h3><span className={account.connected ? "status-dot ready" : "status-dot offline"} /></div>
                  <div className="account-meta">{account.broker} • {account.mode}</div>
                  <div className="mini-metrics">
                    <div><span>Balance</span><strong>${account.balance.toLocaleString()}</strong></div>
                    <div><span>Equity</span><strong>${account.equity.toLocaleString()}</strong></div>
                    <div><span>Margin</span><strong>${account.margin.toLocaleString()}</strong></div>
                    <div><span>Free</span><strong>${account.freeMargin.toLocaleString()}</strong></div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeNav === "settings" && (
          <section className="full-panel">
            <div className="panel-header"><div><span className="eyebrow">RISK</span><h2>Settings</h2></div></div>
            <div className="settings-grid">
              <div className="settings-card">
                <h3>Risk presets</h3>
                <div className="preset-row">
                  {RISK_PRESETS.map((preset) => (
                    <button key={preset.label} className={Number(risk) === Number(preset.value) ? "preset active" : "preset"} onClick={() => setRisk(preset.value)}>{preset.label} {preset.value}%</button>
                  ))}
                </div>
              </div>
              <div className="settings-card">
                <h3>Deterministic pipeline</h3>
                <ul className="bullet-list">
                  <li>Trend: {aiFlags.trend}</li>
                  <li>Momentum: {aiFlags.momentum}</li>
                  <li>Volatility: {aiFlags.volatility}</li>
                  <li>Support/Resistance: {aiFlags.support} / {aiFlags.resistance}</li>
                  <li>Spread: {selected.spread}</li>
                </ul>
              </div>
            </div>
          </section>
        )}

        {activeNav === "admin" && (
          <section className="full-panel">
            <div className="panel-header"><div><span className="eyebrow">ADMIN</span><h2>System health</h2></div></div>
            <div className="admin-grid">
              <div className="settings-card">
                <h3>Service status</h3>
                <ul className="bullet-list">
                  <li>Gateway: {gatewayOnline ? "Online" : "Offline"}</li>
                  <li>Market stream: {marketDataConnected ? "Streaming" : "Disconnected"}</li>
                  <li>Auth: {session ? "Protected" : "Guest"}</li>
                </ul>
              </div>
              <div className="settings-card">
                <h3>Audit events</h3>
                <ul className="bullet-list">
                  <li>Session started for {session?.user.email}</li>
                  <li>Broker validation ready</li>
                  <li>Risk engine active</li>
                </ul>
              </div>
            </div>
          </section>
        )}
      </main>

      <nav className="bottom-nav">
        <NavButton active={activeNav === "command"} icon="⌂" label="Command" onClick={() => setActiveNav("command")} />
        <NavButton active={activeNav === "markets"} icon="◉" label="Markets" onClick={() => setActiveNav("markets")} />
        <NavButton active={activeNav === "trading"} icon="⚡" label="Trading" onClick={() => setActiveNav("trading")} />
        <NavButton active={activeNav === "positions"} icon="▣" label="Positions" onClick={() => setActiveNav("positions")} />
        <NavButton active={activeNav === "accounts"} icon="◎" label="Accounts" onClick={() => setActiveNav("accounts")} />
      </nav>
    </div>
  );
}

function ConnectionCard({ title, value, detail, danger = false }: { title: string; value: string; detail: string; danger?: boolean; }) {
  return (
    <div className="connection-card">
      <div className="connection-title">
        <span className={`status-dot ${danger ? "offline" : "ready"}`} />
        {title}
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function Metric({ title, value, positive = false }: { title: string; value: string; positive?: boolean; }) {
  return (
    <div className="metric">
      <span>{title}</span>
      <strong className={positive ? "positive" : ""}>{value}</strong>
    </div>
  );
}

function MarketPanel({ symbols, selected, onSelect, search, onSearch }: { symbols: SymbolItem[]; selected: string; onSelect: (symbol: string) => void; search: string; onSearch: (value: string) => void; }) {
  return (
    <section className="panel market-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">WATCHLIST</span>
          <h2>Markets</h2>
        </div>
        <span className="mini-label">{symbols.length} symbols</span>
      </div>

      <input className="search" placeholder="Search..." value={search} onChange={(event) => onSearch(event.target.value)} />

      <div className="market-list compact">
        {symbols.map((item) => (
          <button className={`market-row ${selected === item.symbol ? "selected" : ""}`} key={item.symbol} onClick={() => onSelect(item.symbol)}>
            <div>
              <strong>{item.symbol}</strong>
              <small>{item.name}</small>
            </div>
            <div className="market-price">
              <strong>{item.price.toLocaleString()}</strong>
              <span className={item.change >= 0 ? "positive" : "negative"}>{item.change >= 0 ? "+" : ""}{item.change}%</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function ChartPanel({ symbol, timeframe, setTimeframe }: { symbol: SymbolItem; timeframe: string; setTimeframe: (value: string) => void; }) {
  const [candles, setCandles] = useState<LiveCandle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const data = await loadHistoricalCandles(symbol.symbol, timeframe, 80);
        if (!cancelled) setCandles(data);
      } catch (err) {
        if (!cancelled) {
          setCandles([]);
          setError(err instanceof Error ? err.message : "Unable to load market data");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [symbol.symbol, timeframe]);

  const visibleCandles = candles.slice(-50);
  const prices = visibleCandles.flatMap((candle) => [candle.high, candle.low]);
  const highest = prices.length > 0 ? Math.max.apply(null, prices) : 1;
  const range = prices.length > 0 ? Math.max(highest - Math.min.apply(null, prices), 0.000001) : 1;

  return (
    <section className="panel chart-panel">
      <div className="chart-header">
        <div>
          <span className="eyebrow">LIVE MARKET</span>
          <h2>{symbol.symbol}</h2>
          <strong className="chart-price">{symbol.price.toLocaleString()}</strong>
        </div>

        <div className="timeframes">
          {['1m', '5m', '15m', '1h', '4h', '1d'].map((tf) => (
            <button key={tf} className={timeframe === tf ? "active" : ""} onClick={() => setTimeframe(tf)}>{tf}</button>
          ))}
        </div>
      </div>

      <div className="chart">
        {loading ? (
          <div className="chart-watermark">LOADING LIVE MARKET DATA</div>
        ) : error ? (
          <div className="chart-watermark">{error}</div>
        ) : visibleCandles.length === 0 ? (
          <div className="chart-watermark">NO MARKET DATA</div>
        ) : (
          visibleCandles.map((candle) => {
            const highPosition = ((highest - candle.high) / range) * 100;
            const lowPosition = ((highest - candle.low) / range) * 100;
            const openPosition = ((highest - candle.open) / range) * 100;
            const closePosition = ((highest - candle.close) / range) * 100;
            const bodyTop = Math.min(openPosition, closePosition);
            const bodyHeight = Math.max(Math.abs(openPosition - closePosition), 1);
            const wickTop = Math.max(highPosition, 0);
            const wickHeight = Math.max(lowPosition - highPosition, 1);
            const down = candle.close < candle.open;

            return (
              <div className="candle-column" key={candle.time}>
                <div className="wick" style={{ top: `${wickTop}%`, height: `${wickHeight}%`, background: down ? "#ff6675" : "#31d9a1" }} />
                <div className="candle-body" style={{ position: "absolute", top: `${bodyTop}%`, height: `${bodyHeight}%`, background: down ? "#ff6675" : "#31d9a1" }} />
              </div>
            );
          })
        )}

        <div className="chart-grid-line line-one" />
        <div className="chart-grid-line line-two" />
        <div className="chart-grid-line line-three" />
      </div>

      <div className="chart-footer">
        <span>{candles.length > 0 ? `OHLC ${candles.length} candles` : "OHLC —"}</span>
        <span>Bid —</span>
        <span>Ask —</span>
        <span>Feed: {error ? "ERROR" : loading ? "LOADING" : "BINANCE"}</span>
      </div>
    </section>
  );
}

function AIPanel({ risk, setRisk, lot }: { risk: string; setRisk: (value: string) => void; lot: number; }) {
  return (
    <section className="panel ai-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">INTELLIGENCE</span>
          <h2>AI MONSTER</h2>
        </div>
        <span className="ai-badge">READY</span>
      </div>

      <div className="ai-state">
        <div className="monster-ring"><span>AI</span></div>
        <strong>Deterministic signal</strong>
        <small>Trend, structure, volatility, and liquidity are computed from market conditions.</small>
      </div>

      <div className="signal-grid">
        <div><span>Market Bias</span><strong>Trend</strong></div>
        <div><span>Confidence</span><strong>Balanced</strong></div>
        <div><span>Momentum</span><strong>Moderate</strong></div>
        <div><span>Structure</span><strong>Range</strong></div>
      </div>

      <label className="risk-control">
        <span>Risk per trade</span>
        <input type="number" min="0.1" max="10" step="0.1" value={risk} onChange={(event) => setRisk(event.target.value)} />
      </label>

      <div className="lot-result">
        <span>Calculated lot size</span>
        <strong>{lot.toFixed(2)}</strong>
      </div>

      <div className="protection">
        <div><span>Initial SL</span><strong>Tight</strong></div>
        <div><span>Trailing</span><strong>0.1 step</strong></div>
        <div><span>TP</span><strong>None</strong></div>
      </div>
    </section>
  );
}

function PositionsPanel({ positions }: { positions: Position[] }) {
  return (
    <section className="panel positions-panel">
      <div className="panel-header">
        <div><span className="eyebrow">PORTFOLIO</span><h2>Open Positions</h2></div>
        <span className="mini-label">{positions.length} position</span>
      </div>

      <div className="position-list">
        {positions.length === 0 ? (
          <div className="empty-state">No open positions.</div>
        ) : (
          positions.map((position) => (
            <div className="position-row" key={`${position.symbol}-${position.entry}`}>
              <div><strong>{position.symbol}</strong><span className="positive">{position.side}</span></div>
              <div><span>Volume</span><strong>{position.volume.toFixed(2)}</strong></div>
              <div><span>Entry</span><strong>{position.entry}</strong></div>
              <div><span>SL</span><strong>{position.sl}</strong></div>
              <div><span>P/L</span><strong className="positive">+${position.pnl.toFixed(2)}</strong></div>
              <div className="protection-status"><span className="status-dot ready" /> Protected</div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: string; label: string; onClick: () => void; }) {
  return (
    <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}>
      <span className="nav-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
