const API_BASE = "/api";

function getStoredSessionToken() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem("ai-monster-session");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: string } | null;
    return parsed?.token ?? null;
  } catch {
    return null;
  }
}

async function request<T>(
  path: string,
  method: "GET" | "POST" = "GET",
  body?: unknown
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  const token = getStoredSessionToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(API_BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      typeof data === "object" && data && "message" in data
        ? String((data as { message?: string }).message)
        : typeof data === "object" && data && "error" in data
          ? String((data as { error?: string }).error)
          : "API request failed";

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
  mode: "demo" | "test" | "live" | null;
  provider?: string | null;
  environment?: string | null;
  account?: Record<string, unknown> | null;
  currency?: string | null;
  balance?: number;
  equity?: number;
  message?: string;
};

export type NormalizedBrokerStatus = {
  provider: string | null;
  connected: boolean;
  environment: string | null;
  account: Record<string, unknown> | null;
  currency: string | null;
  balance: number;
  equity: number;
  message: string;
};

export type AccountData = {
  balance: number;
  equity: number;
  currency: string;
  margin: number;
  freeMargin: number;
  floatingPnL: number;
};

export type SessionUser = {
  email: string;
  name: string;
};

export type SessionResponse = {
  token: string;
  user: SessionUser;
  expiresAt: number;
};

export type BrokerConfigInput = {
  provider?: string;
  broker?: string;
  mode?: "demo" | "test" | "live";
  environment?: string;
  apiKey?: string;
  apiSecret?: string;
  secret?: string;
  endpoint?: string;
  accountName?: string;
  gatewayUrl?: string;
  username?: string;
  password?: string;
  baseUrl?: string;
  authType?: string;
  token?: string;
  login?: string;
  [key: string]: unknown;
};

export function getGatewayHealth() {
  return request<GatewayHealth>("/health");
}

export function getBrokerStatus() {
  return request<NormalizedBrokerStatus>("/broker/status");
}

export function getBrokerAccount() {
  return request<NormalizedBrokerStatus>("/broker/account");
}

export function getAccount() {
  return request<AccountData>("/account");
}

export function getQuote(symbol: string) {
  return request(`/market/quote/${encodeURIComponent(symbol)}`);
}

export function getAuthSession() {
  return request<SessionResponse | null>("/auth/session");
}

export function registerUser(input: {
  name: string;
  email: string;
  password: string;
}) {
  return request<SessionResponse>("/auth/register", "POST", input);
}

export function loginUser(input: {
  email: string;
  password: string;
}) {
  return request<SessionResponse>("/auth/login", "POST", input);
}

export function logoutUser() {
  return request<{ ok: true }>("/auth/logout", "POST", {});
}

export function resetPassword(email: string) {
  return request<{ ok: true; email: string }>("/auth/reset", "POST", {
    email,
  });
}

export function connectBroker(payload: BrokerConfigInput) {
  return request<NormalizedBrokerStatus>("/broker/connect", "POST", payload);
}

export function testBrokerConnection(payload: BrokerConfigInput) {
  return request<NormalizedBrokerStatus>("/broker/test", "POST", payload);
}

export function disconnectBroker() {
  return request<{ ok: true; status: NormalizedBrokerStatus }>(
    "/broker/disconnect",
    "POST",
    {},
  );
}
