const rawApiBase = (import.meta.env.VITE_API_BASE_URL || "/api").trim();
const API_BASE = rawApiBase.endsWith("/api")
  ? rawApiBase
  : `${rawApiBase.replace(/\/$/, "")}/api`;

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

function getSafeApiErrorMessage(data: unknown, fallback: string): string {
  if (typeof data === "object" && data !== null) {
    const record = data as Record<string, unknown>;
    const message =
      typeof record.message === "string"
        ? record.message
        : typeof record.error === "string"
          ? record.error
          : typeof record.detail === "string"
            ? record.detail
            : "";

    if (message) {
      return message;
    }
  }

  return fallback;
}

async function request<T>(
  path: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
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

  try {
    const response = await fetch(API_BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let data: unknown = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      const errorMessage = getSafeApiErrorMessage(data, "API request failed");
      throw new Error(errorMessage);
    }

    return data as T;
  } catch (error) {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (message.includes("failed to fetch") || message.includes("networkerror")) {
        throw new Error("Network error. Please check your connection and try again.");
      }
      if (message.includes("cors") || message.includes("not allowed by cors")) {
        throw new Error("CORS/network configuration error. Please try again or contact support.");
      }
      if (message === "authentication required" || message.includes("auth_required")) {
        throw new Error("Authentication required.");
      }
      if (message.includes("invalid credentials") || message.includes("user not found")) {
        throw new Error("Invalid credentials.");
      }
      if (message.includes("session") || message.includes("expired") || message.includes("token")) {
        throw new Error("Session expired. Please sign in again.");
      }
      if (message.includes("server unavailable") || message.includes("internal server error")) {
        throw new Error("Server unavailable. Please try again later.");
      }
      throw new Error(error.message || "Request failed.");
    }

    throw new Error("Server unavailable. Please try again later.");
  }
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
