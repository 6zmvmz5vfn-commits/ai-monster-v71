const API_BASE = "/api";

async function request<T>(path: string): Promise<T> {
  const response = await fetch(API_BASE + path);
  const data = await response.json();

  if (!response.ok) {
    let message = "API request failed";

    if (data && data.message) {
      message = data.message;
    } else if (data && data.error) {
      message = data.error;
    }

    throw new Error(message);
  }

  return data as T;
}

export type GatewayHealth = {
  ok: boolean;
  service: string;
  brokerConnected: boolean;
  marketDataConnected: boolean;
};

export type BrokerStatusResponse = {
  connected: boolean;
  broker: string | null;
  mode: "demo" | "live" | null;
};

export type AccountData = {
  balance: number;
  equity: number;
  currency: string;
};

export function getGatewayHealth() {
  return request<GatewayHealth>("/health");
}

export function getBrokerStatus() {
  return request<BrokerStatusResponse>("/broker/status");
}

export function getAccount() {
  return request<AccountData>("/account");
}

export function getQuote(symbol: string) {
  return request("/market/quote/" + encodeURIComponent(symbol));
}
