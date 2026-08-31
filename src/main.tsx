import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { loadHistoricalCandles } from "./services/marketHistory";
import BrokerCenter from "./components/BrokerCenter";
import { getAccount, getGatewayHealth } from "./services/api";
import type { LiveCandle } from "./services/candleStore";
import { subscribeLiveQuote } from "./services/marketSocket";

type Nav = "command" | "markets" | "trading";

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

const INITIAL_SYMBOLS: SymbolItem[] = [
  {
    symbol: "XAUUSD",
    name: "Gold / US Dollar",
    price: 3432.2,
    change: 0.12,
    spread: 0.4,
  },
];

const INITIAL_POSITIONS: Position[] = [
  {
    symbol: "XAUUSD",
    side: "BUY",
    volume: 0.03,
    entry: 3432.2,
    sl: 3430.2,
    pnl: 18.62,
  },
];

function App() {
  const [activeNav, setActiveNav] = useState<Nav>("command");
 const [symbols, setSymbols] = useState<SymbolItem[]>(INITIAL_SYMBOLS);
  const [selectedSymbol, setSelectedSymbol] = useState("XAUUSD");
  const [timeframe, setTimeframe] = useState("5m");
  const [risk, setRisk] = useState("1.0");
  const [positions] = useState<Position[]>(INITIAL_POSITIONS);
  const [search, setSearch] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [gatewayOnline, setGatewayOnline] = useState(false);
  const [marketDataConnected, setMarketDataConnected] = useState(false);
  const [accountBalance, setAccountBalance] = useState<number | null>(null);
const [accountEquity, setAccountEquity] = useState<number | null>(null);
const [accountCurrency, setAccountCurrency] = useState("USD");

  const selected = useMemo(
    () => symbols.find((item) => item.symbol === selectedSymbol) ?? symbols[0],
    [symbols, selectedSymbol]
  );


  const estimatedLot = useMemo(() => {
  if (accountBalance === null) return 0;

  const riskMoney = accountBalance * (Number(risk) / 100);
  const stopDistance = selected.symbol === "XAUUSD" ? 2.0 : 0.002;
  const raw = riskMoney / Math.max(stopDistance * 100, 1);

  return Math.min(5, Number(raw.toFixed(2)));
}, [accountBalance, risk, selected]);

  
useEffect(() => {
  const unsubscribe = subscribeLiveQuote((quote) => {
    setSymbols((current) =>
      current.map((item) => {
        if (item.symbol !== quote.symbol) {
          return item;
        }

        return {
          ...item,
          price: quote.price,
          spread: Number(
            Math.max((quote.ask - quote.bid) * 100, 0).toFixed(2)
          ),
        };
      })
    );
  });

  return unsubscribe;
}, []);

useEffect(() => {
    let cancelled = false;

    const checkGateway = async () => {
      try {
        const health = await getGatewayHealth();

        if (!cancelled) {
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

        }
      } catch {
        if (!cancelled) {
          setGatewayOnline(false);
          setMarketDataConnected(false);
        }
      }
    };

    void checkGateway();

    const statusTimer = window.setInterval(checkGateway, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(statusTimer);
    };
  }, []);

  // Live market prices will be supplied by the API gateway.

  const filteredSymbols = symbols.filter(
    (item) =>
      item.symbol.toLowerCase().includes(search.toLowerCase()) ||
      item.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <div className="brand-name">AI MONSTER</div>
            <div className="brand-version">V71 • PREMIUM TERMINAL</div>
          </div>
        </div>

        <div className="desktop-status">
          <span className={`status-dot ${marketDataConnected ? "ready" : "offline"}`} />
          MARKET DATA
          <strong>{marketDataConnected ? "LIVE" : "NOT CONNECTED"}</strong>
        </div>

        <button
          className="menu-button"
          onClick={() => setMobileMenu((value) => !value)}
          aria-label="Open menu"
        >
          ☰
        </button>
      </header>

      {mobileMenu && (
        <div className="mobile-menu">
          <button onClick={() => setMobileMenu(false)}>Broker Accounts</button>
          <button onClick={() => setMobileMenu(false)}>Trade History</button>
          <button onClick={() => setMobileMenu(false)}>Risk Settings</button>
          <button onClick={() => setMobileMenu(false)}>Security</button>
          <button onClick={() => setMobileMenu(false)}>API Connections</button>
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
           <strong>
  {accountEquity === null ? "—" : `$${(accountEquity as number).toLocaleString()}`}
</strong>
<small>
  {accountEquity === null
    ? "Broker account not connected"
    : "Live broker equity"}
</small>
          </div>
        </section>

        <section className="connection-grid">
          <ConnectionCard
            title="Market Data"
            value={marketDataConnected ? "LIVE" : "Not Connected"}
            detail={
              gatewayOnline
                ? "Gateway online"
                : "Waiting for gateway"
            }
            danger={!marketDataConnected}
          />
          <ConnectionCard
            title="Execution"
            value="Locked"
            detail="Waiting for verification"
            danger
          />
          <ConnectionCard
            title="AI Engine"
            value="Ready"
            detail="Awaiting live market feed"
          />
          <ConnectionCard
            title="Protection"
            value="Armed"
            detail="Protective trailing enabled"
          />
        </section>

        {activeNav === "command" && (
          <>
            <section className="metrics">
             <Metric
  title="Balance"
  value={accountBalance === null ? "—" : `$${(accountBalance as number).toLocaleString()}`}
/>

<Metric
  title="Equity"
  value={accountEquity === null ? "—" : `$${(accountEquity as number).toLocaleString()}`}
/>

<Metric
  title="Floating P/L"
  value="—"
/>
            </section>

            <section className="main-grid">
              <MarketPanel
                symbols={filteredSymbols}
                selected={selectedSymbol}
                onSelect={setSelectedSymbol}
                search={search}
                onSearch={setSearch}
              />

              <ChartPanel
                symbol={selected}
                timeframe={timeframe}
                setTimeframe={setTimeframe}
              />

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
              <span className="connection-pill">
                <span className="status-dot offline" />
                Feed offline
              </span>
            </div>

            <input
              className="search"
              placeholder="Search symbols..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />

            <div className="market-list">
              {filteredSymbols.map((item) => (
                <button
                  className="market-row"
                  key={item.symbol}
                  onClick={() => {
                    setSelectedSymbol(item.symbol);
                    setActiveNav("command");
                  }}
                >
                  <div>
                    <strong>{item.symbol}</strong>
                    <small>{item.name}</small>
                  </div>
                  <strong>{item.price.toLocaleString()}</strong>
                  <span className={item.change >= 0 ? "positive" : "negative"}>
                    {item.change >= 0 ? "+" : ""}
                    {item.change}%
                  </span>
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
              <span className="locked-badge">EXECUTION LOCKED</span>
            </div>

            <div className="trade-symbol">
              <div>
              <span>{selected.symbol}</span>
                <strong>{selected.price.toLocaleString()}</strong>
              </div>
              <span className="offline-label">BROKER OFFLINE</span>
            </div>

            <div className="risk-editor">
              <label>
                Risk per trade
                <input
                  type="number"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={risk}
                  onChange={(event) => setRisk(event.target.value)}
                />
              </label>

              <div className="calculated">
                <span>Calculated volume</span>
                <strong>{estimatedLot.toFixed(2)} lots</strong>
              </div>

              <div className="calculated">
                <span>Initial protection</span>
                <strong>Tight SL</strong>
              </div>

              <div className="calculated">
                <span>Trailing mode</span>
                <strong>0.1 step</strong>
              </div>
            </div>

            <div className="execution-buttons">
              <button disabled>BUY</button>
              <button disabled>SELL</button>
            </div>

            <div className="execution-notice">
              <span>🔒</span>
              <div>
                <strong>Live execution is locked</strong>
                <p>
                  Connect and verify a supported broker before real orders can
                  be submitted.
                </p>
              </div>
            </div>
          </section>
        )}
      </main>

      <nav className="bottom-nav">
        <NavButton
          active={activeNav === "command"}
          icon="⌂"
          label="Command"
          onClick={() => setActiveNav("command")}
        />

        <NavButton
          active={activeNav === "markets"}
          icon="◉"
          label="Markets"
          onClick={() => setActiveNav("markets")}
        />

        <NavButton
          active={activeNav === "trading"}
          icon="⚡"
          label="Trading"
          onClick={() => setActiveNav("trading")}
        />
      </nav>
    </div>
  );
}

function ConnectionCard({
  title,
  value,
  detail,
  danger = false,
}: {
  title: string;
  value: string;
  detail: string;
  danger?: boolean;
}) {
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

function Metric({
  title,
  value,
  positive = false,
}: {
  title: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="metric">
      <span>{title}</span>
      <strong className={positive ? "positive" : ""}>{value}</strong>
    </div>
  );
}

function MarketPanel({
  symbols,
  selected,
  onSelect,
  search,
  onSearch,
}: {
  symbols: SymbolItem[];
  selected: string;
  onSelect: (symbol: string) => void;
  search: string;
  onSearch: (value: string) => void;
}) {
  return (
    <section className="panel market-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">WATCHLIST</span>
          <h2>Markets</h2>
        </div>
        <span className="mini-label">6 symbols</span>
      </div>

      <input
        className="search"
        placeholder="Search..."
        value={search}
        onChange={(event) => onSearch(event.target.value)}
      />

      <div className="market-list compact">
        {symbols.map((item) => (
          <button
            className={`market-row ${
  selected === item.symbol ? "selected" : ""
}`}
            key={item.symbol}
            onClick={() => onSelect(item.symbol)}
          >
            <div>
              <strong>{item.symbol}</strong>
              <small>{item.name}</small>
            </div>
            <div className="market-price">
              <strong>{item.price.toLocaleString()}</strong>
               <span className={item.change >= 0 ? "positive" : "negative"}>
                {item.change >= 0 ? "+" : ""}
                {item.change}%
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function ChartPanel({
  symbol,
  timeframe,
  setTimeframe,
}: {
  symbol: SymbolItem;
  timeframe: string;
  setTimeframe: (value: string) => void;
}) {
  const [candles, setCandles] = useState<LiveCandle[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const data = await loadHistoricalCandles(
          symbol.symbol,
          timeframe,
          80
        );

        if (!cancelled) {
          setCandles(data);
        }
      } catch (err) {
        if (!cancelled) {
          setCandles([]);
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load market data"
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return function cleanup() {
      cancelled = true;
    };
  }, [symbol.symbol, timeframe]);

  const visibleCandles = candles.slice(-50);

  const prices = visibleCandles.flatMap(function (candle) {
    return [candle.high, candle.low];
  });

  const highest = prices.length > 0 ? Math.max.apply(null, prices) : 1;
  const range =
    prices.length > 0
      ? Math.max(
          highest - Math.min.apply(null, prices),
          0.000001
        )
      : 1;

  return (
    <section className="panel chart-panel">
      <div className="chart-header">
        <div>
          <span className="eyebrow">LIVE MARKET</span>
          <h2>{symbol.symbol}</h2>
          <strong className="chart-price">
            {symbol.price.toLocaleString()}
          </strong>
        </div>

        <div className="timeframes">
          {["1m", "5m", "15m", "1h", "4h", "1d"].map(function (tf) {
            return (
              <button
                key={tf}
                className={timeframe === tf ? "active" : ""}
                onClick={function () {
                  setTimeframe(tf);
                }}
              >
                {tf}
              </button>
            );
          })}
        </div>
      </div>

      <div className="chart">
        {loading ? (
          <div className="chart-watermark">
            LOADING LIVE MARKET DATA
          </div>
        ) : error ? (
          <div className="chart-watermark">
            {error}
          </div>
        ) : visibleCandles.length === 0 ? (
          <div className="chart-watermark">
            NO MARKET DATA
          </div>
        ) : (
          visibleCandles.map(function (candle) {
            const highPosition =
              ((highest - candle.high) / range) * 100;

            const lowPosition =
              ((highest - candle.low) / range) * 100;

            const openPosition =
              ((highest - candle.open) / range) * 100;

            const closePosition =
              ((highest - candle.close) / range) * 100;

            const bodyTop = Math.min(
              openPosition,
              closePosition
            );

            const bodyHeight = Math.max(
              Math.abs(openPosition - closePosition),
              1
            );

            const wickTop = Math.max(
              highPosition,
              0
            );

            const wickHeight = Math.max(
              lowPosition - highPosition,
              1
            );

            const down = candle.close < candle.open;

            return (
              <div
                className="candle-column"
                key={candle.time}
              >
                <div
                  className="wick"
                  style={{top: wickTop + "%",
                    height: wickHeight + "%",
                    background: down
                      ? "#ff6675"
                      : "#31d9a1",
                  }}
                />

                <div
                  className="candle-body"
                  style={{
                    position: "absolute",
                    top: bodyTop + "%",
                    height: bodyHeight + "%",
                    background: down
                      ? "#ff6675"
                      : "#31d9a1",
                  }}
                />
              </div>
            );
          })
        )}

        <div className="chart-grid-line line-one" />
        <div className="chart-grid-line line-two" />
        <div className="chart-grid-line line-three" />
      </div>

      <div className="chart-footer">
        <span>
          {candles.length > 0
            ? "OHLC " + candles.length + " candles"
            : "OHLC —"}
        </span>

        <span>Bid —</span>
        <span>Ask —</span>

        <span>
          Feed: {error ? "ERROR" : loading ? "LOADING" : "BINANCE"}
        </span>
      </div>
    </section>
  );
}
function AIPanel({
  risk,
  setRisk,
  lot,
}: {
  risk: string;
  setRisk: (value: string) => void;
  lot: number;
}) {
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
        <div className="monster-ring">
          <span>AI</span>
        </div>

        <strong>Awaiting Market</strong>
        <small>Connect a live feed to activate analysis.</small>
      </div>

      <div className="signal-grid">
        <div>
          <span>Market Bias</span>
          <strong>—</strong>
        </div>
        <div>
          <span>Confidence</span>
          <strong>—</strong>
        </div>
        <div>
          <span>Momentum</span>
          <strong>—</strong>
        </div>
        <div>
          <span>Structure</span>
          <strong>—</strong>
        </div>
      </div>

      <label className="risk-control">
        <span>Risk per trade</span>
        <input
          type="number"
          min="0.1"
          max="10"
          step="0.1"
          value={risk}
          onChange={(event) => setRisk(event.target.value)}
        />
      </label>

      <div className="lot-result">
        <span>Calculated lot size</span>
        <strong>{lot.toFixed(2)}</strong>
      </div>

      <div className="protection">
        <div>
          <span>Initial SL</span>
          <strong>Tight</strong>
        </div>
        <div>
          <span>Trailing</span>
          <strong>0.1 step</strong>
        </div>
        <div>
          <span>TP</span>
          <strong>None</strong>
        </div>
      </div>
    </section>
  );
}

function PositionsPanel({ positions }: { positions: Position[] }) {
  return (
    <section className="panel positions-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">PORTFOLIO</span>
          <h2>Open Positions</h2>
        </div>
        <span className="mini-label">{positions.length} position</span>
      </div>

      <div className="position-list">
        {positions.map((position) => (
          <div className="position-row" key={`${position.symbol}-${position.entry}`}>
            <div>
              <strong>{position.symbol}</strong>
              <span className="positive">{position.side}</span>
            </div>

            <div>
              <span>Volume</span>
              <strong>{position.volume.toFixed(2)}</strong>
            </div>

            <div>
              <span>Entry</span>
              <strong>{position.entry}</strong>
            </div>

            <div>
              <span>SL</span>
              <strong>{position.sl}</strong>
            </div>

            <div>
              <span>P/L</span>
              <strong className="positive">+${position.pnl.toFixed(2)}</strong>
            </div>

            <div className="protection-status">
              <span className="status-dot ready" />
              Protected
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function NavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}) {
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
  </React.StrictMode>
);
