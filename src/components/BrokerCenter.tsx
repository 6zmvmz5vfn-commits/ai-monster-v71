import React, { useEffect, useMemo, useState } from "react";
import {
  connectBroker,
  disconnectBroker,
  getBrokerStatus,
  testBrokerConnection,
  type NormalizedBrokerStatus,
} from "../services/api";

type BrokerId = "binance" | "bybit" | "alpaca" | "mt5" | "custom";

type BrokerOption = {
  id: BrokerId;
  name: string;
  description: string;
};

type BrokerFormState = {
  apiKey: string;
  apiSecret: string;
  environment: string;
  gatewayUrl: string;
  login: string;
  password: string;
  baseUrl: string;
  authType: string;
  username: string;
  token: string;
  accountName: string;
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
    description: "Crypto exchange connectivity",
  },
  {
    id: "alpaca",
    name: "Alpaca",
    description: "US equities and paper trading API",
  },
  {
    id: "mt5",
    name: "MT5 gateway",
    description: "MetaTrader 5 gateway status and credentials",
  },
  {
    id: "custom",
    name: "Custom Broker API",
    description: "Connect a compatible broker gateway",
  },
];

const createDefaultForms = (): Record<BrokerId, BrokerFormState> => ({
  binance: {
    apiKey: "",
    apiSecret: "",
    environment: "testnet",
    gatewayUrl: "",
    login: "",
    password: "",
    baseUrl: "",
    authType: "api_key",
    username: "",
    token: "",
    accountName: "",
  },
  bybit: {
    apiKey: "",
    apiSecret: "",
    environment: "testnet",
    gatewayUrl: "",
    login: "",
    password: "",
    baseUrl: "",
    authType: "api_key",
    username: "",
    token: "",
    accountName: "",
  },
  alpaca: {
    apiKey: "",
    apiSecret: "",
    environment: "paper",
    gatewayUrl: "",
    login: "",
    password: "",
    baseUrl: "",
    authType: "api_key",
    username: "",
    token: "",
    accountName: "",
  },
  mt5: {
    apiKey: "",
    apiSecret: "",
    environment: "demo",
    gatewayUrl: "",
    login: "",
    password: "",
    baseUrl: "",
    authType: "api_key",
    username: "",
    token: "",
    accountName: "",
  },
  custom: {
    apiKey: "",
    apiSecret: "",
    environment: "custom",
    gatewayUrl: "",
    login: "",
    password: "",
    baseUrl: "",
    authType: "api_key",
    username: "",
    token: "",
    accountName: "",
  },
});

export default function BrokerCenter() {
  const [selectedBroker, setSelectedBroker] = useState<BrokerId>("binance");
  const [forms, setForms] = useState<Record<BrokerId, BrokerFormState>>(
    createDefaultForms,
  );
  const [status, setStatus] = useState<
    "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "ERROR"
  >("DISCONNECTED");
  const [statusInfo, setStatusInfo] = useState<NormalizedBrokerStatus | null>(null);
  const [error, setError] = useState<string>("");
  const [message, setMessage] = useState<string>("");

  const selected = useMemo(
    () => BROKERS.find((item) => item.id === selectedBroker) ?? BROKERS[0],
    [selectedBroker],
  );

  function updateField(field: keyof BrokerFormState, value: string) {
    setForms((current) => ({
      ...current,
      [selectedBroker]: {
        ...current[selectedBroker],
        [field]: value,
      },
    }));
  }

  function clearSecretsForCurrentProvider() {
    setForms((current) => ({
      ...current,
      [selectedBroker]: {
        ...current[selectedBroker],
        apiSecret: "",
        password: "",
        token: "",
      },
    }));
  }

  async function refreshBrokerStatus() {
    try {
      setStatus("CONNECTING");
      setError("");
      const data = await getBrokerStatus();
      setStatusInfo(data);
      setStatus(data.connected ? "CONNECTED" : "DISCONNECTED");
      if (data.provider) {
        setSelectedBroker(data.provider.toLowerCase() as BrokerId);
      }
      if (data.message) {
        setMessage(data.message);
      }
    } catch (fetchError) {
      setStatus("ERROR");
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Unable to load broker status.",
      );
    }
  }

  async function submitConnection(action: "connect" | "test") {
    const provider = selectedBroker;
    const currentForm = forms[provider];

    setStatus("CONNECTING");
    setError("");
    setMessage("");

    const payload = {
      provider,
      environment: currentForm.environment,
      apiKey: currentForm.apiKey.trim(),
      apiSecret: currentForm.apiSecret.trim(),
      secret: currentForm.apiSecret.trim(),
      gatewayUrl: currentForm.gatewayUrl.trim(),
      login: currentForm.login.trim(),
      password: currentForm.password.trim(),
      baseUrl: currentForm.baseUrl.trim(),
      authType: currentForm.authType,
      username: currentForm.username.trim(),
      token: currentForm.token.trim(),
      accountName: currentForm.accountName.trim(),
    };

    try {
      const result =
        action === "connect"
          ? await connectBroker(payload)
          : await testBrokerConnection(payload);

      setStatusInfo(result);
      setStatus(result.connected ? "CONNECTED" : "DISCONNECTED");
      setMessage(result.message || "Broker status updated.");
      if (!result.connected) {
        setError(result.message || "Broker connection failed.");
      }
      clearSecretsForCurrentProvider();
    } catch (fetchError) {
      const messageText =
        fetchError instanceof Error
          ? fetchError.message
          : "Unable to validate broker connection.";
      setStatus("ERROR");
      setError(messageText);
      setMessage("");
      clearSecretsForCurrentProvider();
    }
  }

  async function disconnectCurrentBroker() {
    try {
      setStatus("CONNECTING");
      setError("");
      const result = await disconnectBroker();
      setStatusInfo(result.status ?? null);
      setStatus("DISCONNECTED");
      setMessage(result.status?.message || "Broker disconnected.");
      clearSecretsForCurrentProvider();
    } catch (fetchError) {
      setStatus("ERROR");
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Unable to disconnect broker.",
      );
    }
  }

  useEffect(() => {
    void refreshBrokerStatus();
  }, []);

  const connected = Boolean(statusInfo?.connected ?? false);

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
            value={selectedBroker}
            onChange={(event) => {
              setSelectedBroker(event.target.value as BrokerId);
              setStatus("DISCONNECTED");
              setError("");
              setMessage("");
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
          <label>Connection Environment</label>
          <div className="mode-selector">
            {selectedBroker === "binance" || selectedBroker === "bybit" ? (
              <>
                <button
                  type="button"
                  className={forms[selectedBroker].environment === "testnet" ? "selected" : ""}
                  onClick={() => updateField("environment", "testnet")}
                >
                  Testnet
                </button>
                <button
                  type="button"
                  className={forms[selectedBroker].environment === "live" ? "selected" : ""}
                  onClick={() => updateField("environment", "live")}
                >
                  Live
                </button>
              </>
            ) : selectedBroker === "alpaca" ? (
              <>
                <button
                  type="button"
                  className={forms[selectedBroker].environment === "paper" ? "selected" : ""}
                  onClick={() => updateField("environment", "paper")}
                >
                  Paper
                </button>
                <button
                  type="button"
                  className={forms[selectedBroker].environment === "live" ? "selected" : ""}
                  onClick={() => updateField("environment", "live")}
                >
                  Live
                </button>
              </>
            ) : selectedBroker === "mt5" ? (
              <>
                <button
                  type="button"
                  className={forms[selectedBroker].environment === "demo" ? "selected" : ""}
                  onClick={() => updateField("environment", "demo")}
                >
                  Demo
                </button>
                <button
                  type="button"
                  className={forms[selectedBroker].environment === "live" ? "selected" : ""}
                  onClick={() => updateField("environment", "live")}
                >
                  Live
                </button>
              </>
            ) : (
              <button
                type="button"
                className={forms[selectedBroker].environment === "custom" ? "selected" : ""}
                onClick={() => updateField("environment", "custom")}
              >
                Custom
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="broker-form-grid">
        {selectedBroker === "binance" || selectedBroker === "bybit" ? (
          <>
            <label>
              API Key
              <input
                type="text"
                value={forms[selectedBroker].apiKey}
                onChange={(event) => updateField("apiKey", event.target.value)}
                autoComplete="off"
              />
            </label>
            <label>
              API Secret
              <input
                type="password"
                value={forms[selectedBroker].apiSecret}
                onChange={(event) => updateField("apiSecret", event.target.value)}
                autoComplete="off"
              />
            </label>
          </>
        ) : null}

        {selectedBroker === "alpaca" ? (
          <>
            <label>
              API Key
              <input
                type="text"
                value={forms.alpaca.apiKey}
                onChange={(event) => updateField("apiKey", event.target.value)}
                autoComplete="off"
              />
            </label>
            <label>
              API Secret
              <input
                type="password"
                value={forms.alpaca.apiSecret}
                onChange={(event) => updateField("apiSecret", event.target.value)}
                autoComplete="off"
              />
            </label>
          </>
        ) : null}

        {selectedBroker === "mt5" ? (
          <>
            <label>
              Gateway URL
              <input
                type="text"
                value={forms.mt5.gatewayUrl}
                onChange={(event) => updateField("gatewayUrl", event.target.value)}
                placeholder="https://gateway.example.com"
                autoComplete="off"
              />
            </label>
            <label>
              Login
              <input
                type="text"
                value={forms.mt5.login}
                onChange={(event) => updateField("login", event.target.value)}
                autoComplete="off"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={forms.mt5.password}
                onChange={(event) => updateField("password", event.target.value)}
                autoComplete="off"
              />
            </label>
          </>
        ) : null}

        {selectedBroker === "custom" ? (
          <>
            <label>
              API Base URL
              <input
                type="text"
                value={forms.custom.baseUrl}
                onChange={(event) => updateField("baseUrl", event.target.value)}
                placeholder="https://broker.example.com"
                autoComplete="off"
              />
            </label>
            <label>
              Auth Type
              <select
                value={forms.custom.authType}
                onChange={(event) => updateField("authType", event.target.value)}
              >
                <option value="api_key">API Key</option>
                <option value="bearer">Bearer Token</option>
                <option value="basic">Basic Auth</option>
              </select>
            </label>
            <label>
              API Key / Client ID
              <input
                type="text"
                value={forms.custom.apiKey}
                onChange={(event) => updateField("apiKey", event.target.value)}
                autoComplete="off"
              />
            </label>
            <label>
              Secret / Token
              <input
                type="password"
                value={forms.custom.apiSecret}
                onChange={(event) => updateField("apiSecret", event.target.value)}
                autoComplete="off"
              />
            </label>
            <label>
              Account Name
              <input
                type="text"
                value={forms.custom.accountName}
                onChange={(event) => updateField("accountName", event.target.value)}
                autoComplete="off"
              />
            </label>
          </>
        ) : null}
      </div>

      <div className="broker-actions">
        <button
          type="button"
          className="connect-broker"
          onClick={() => void submitConnection("test")}
          disabled={status === "CONNECTING"}
        >
          {status === "CONNECTING" ? "VERIFYING..." : "TEST CONNECTION"}
        </button>
        <button
          type="button"
          className="connect-broker"
          onClick={() => void submitConnection("connect")}
          disabled={status === "CONNECTING"}
        >
          {status === "CONNECTING" ? "CONNECTING..." : `CONNECT ${selected.name.toUpperCase()}`}
        </button>
        {connected ? (
          <button
            type="button"
            className="disconnect-broker"
            onClick={() => void disconnectCurrentBroker()}
            disabled={status === "CONNECTING"}
          >
            DISCONNECT
          </button>
        ) : null}
      </div>

      {error ? <div className="auth-alert error">{error}</div> : null}
      {message ? <div className="auth-alert success">{message}</div> : null}

      <div className="broker-data-grid">
        <div>
          <span>PROVIDER</span>
          <strong>{statusInfo?.provider ?? selected.name}</strong>
          <small>{statusInfo?.connected ? "Broker connected" : "Waiting for broker"}</small>
        </div>

        <div>
          <span>ENVIRONMENT</span>
          <strong>{statusInfo?.environment ?? "—"}</strong>
          <small>Secure provider context</small>
        </div>

        <div>
          <span>BALANCE</span>
          <strong>
            {statusInfo && Number.isFinite(statusInfo.balance)
              ? `$${statusInfo.balance.toFixed(2)}`
              : "—"}
          </strong>
          <small>{statusInfo?.currency ?? "No live balance"}</small>
        </div>

        <div>
          <span>EQUITY</span>
          <strong>
            {statusInfo && Number.isFinite(statusInfo.equity)
              ? `$${statusInfo.equity.toFixed(2)}`
              : "—"}
          </strong>
          <small>{connected ? "Provider ready" : "Provider authorization"}</small>
        </div>
      </div>
    </section>
  );
}
