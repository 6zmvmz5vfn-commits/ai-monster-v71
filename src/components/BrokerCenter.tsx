import React, { useEffect, useState } from "react";
import type { AccountMode, BrokerStatus } from "../services/broker";
import { getBrokerStatus } from "../services/api";

type BrokerOption = {
  id: string;
  name: string;
  description: string;
};

const BROKERS: BrokerOption[] = [
  {
    id: "binance",
    name: "Binance",
    description: "Crypto trading and market data",
  },
  {
    id: "bybit",
    name: "Bybit",
    description: "Crypto trading and market data",
  },
  {
    id: "alpaca",
    name: "Alpaca",
    description: "API-based trading",
  },
  {
    id: "custom",
    name: "Custom Broker API",
    description: "Connect a compatible broker gateway",
  },
];

export default function BrokerCenter() {
  const [broker, setBroker] = useState("binance");
  const [mode, setMode] = useState<AccountMode>("demo");
  const [status, setStatus] = useState<BrokerStatus>("DISCONNECTED");

  const selected =
    BROKERS.find((item) => item.id === broker) ?? BROKERS[0];

  async function refreshBrokerStatus() {
    try {
      setStatus("CONNECTING");

      const data = await getBrokerStatus();

      if (data.connected) {
        setStatus("CONNECTED");

        if (data.broker) {
          setBroker(data.broker.toLowerCase());
        }

        if (data.mode === "demo" || data.mode === "live") {
          setMode(data.mode);
        }
      } else {
        setStatus("DISCONNECTED");
      }
    } catch {
      setStatus("ERROR");
    }
  }

  useEffect(() => {
    void refreshBrokerStatus();
  }, []);

  return (
    <section className="broker-center">
      <div className="broker-heading">
        <div>
          <span className="eyebrow">BROKER CENTER</span>
          <h2>Connect Trading Account</h2>
          <p>{selected.description}</p>
        </div>

        <div className={`broker-status ${status.toLowerCase()}`}>
          <span />
          {status}
        </div>
      </div>

      <div className="broker-grid">
        <div className="broker-control">
          <label htmlFor="broker-select">Broker</label>

          <select
            id="broker-select"
            value={broker}
            onChange={(event) => {
              setBroker(event.target.value);
              setStatus("DISCONNECTED");
            }}
          >
            {BROKERS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>

        <div className="broker-control">
          <label>Account Mode</label>

          <div className="mode-selector">
            <button
              type="button"
              className={mode === "demo" ? "selected" : ""}
              onClick={() => {
                setMode("demo");
                setStatus("DISCONNECTED");
              }}
            >
              Demo
            </button>

            <button
              type="button"
              className={mode === "live" ? "selected" : ""}
              onClick={() => {
                setMode("live");
                setStatus("DISCONNECTED");
              }}
            >
              Live
            </button>
          </div>
        </div>
      </div>

      <div className="broker-actions">
        <button
          type="button"
          className="connect-broker"
          onClick={() => void refreshBrokerStatus()}
          disabled={status === "CONNECTING"}
        >
          {status === "CONNECTING"
            ? "CHECKING..."
            : `CHECK ${selected.name.toUpperCase()}`}
        </button>
      </div>

      <div className="broker-data-grid">
        <div>
          <span>ACCOUNT</span>
          <strong>—</strong>
          <small>
            {status === "CONNECTED"
              ? "Broker connected"
              : "Waiting for broker"}
          </small>
        </div>

        <div>
          <span>BALANCE</span>
          <strong>—</strong>
          <small>Real broker value</small>
        </div>

        <div>
          <span>EQUITY</span>
          <strong>—</strong>
          <small>Real broker value</small>
        </div>

        <div>
          <span>EXECUTION</span>
          <strong>
            {status === "CONNECTED" ? "READY" : "LOCKED"}
          </strong>
          <small>
            {status === "CONNECTED"
              ? "Provider connected"
              : "Provider authorization"}
          </small>
        </div>
      </div>
    </section>
  );
}