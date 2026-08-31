/**
 * Server-only Bybit V5 signed-request helper.
 *
 * Credentials are read from the server runtime inside each call and never
 * leave this module: no key material is returned to callers or the browser.
 */

const BYBIT_BASE = "https://api.bybit.com";
const RECV_WINDOW = "5000";

export type BybitCredentials = { apiKey: string; apiSecret: string };

export function readBybitCredentials(): BybitCredentials | null {
  const apiKey = process.env["BYBIT_API_KEY"];
  const apiSecret = process.env["BYBIT_API_SECRET"];
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret };
}

async function sign(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

type SignedResponse<T> = { retCode: number; retMsg: string; result: T };

async function request<T>(
  credentials: BybitCredentials,
  method: "GET" | "POST",
  path: string,
  payload: Record<string, string | number> = {},
): Promise<T> {
  const timestamp = Date.now().toString();
  const query = method === "GET"
    ? new URLSearchParams(Object.entries(payload).map(([key, value]) => [key, String(value)])).toString()
    : "";
  const body = method === "POST" ? JSON.stringify(payload) : "";
  const signature = await sign(
    credentials.apiSecret,
    timestamp + credentials.apiKey + RECV_WINDOW + (method === "GET" ? query : body),
  );

  const response = await fetch(`${BYBIT_BASE}${path}${query ? `?${query}` : ""}`, {
    method,
    headers: {
      "X-BAPI-API-KEY": credentials.apiKey,
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-RECV-WINDOW": RECV_WINDOW,
      "X-BAPI-SIGN": signature,
      "content-type": "application/json",
      accept: "application/json",
    },
    ...(method === "POST" ? { body } : {}),
  });

  const json = (await response.json()) as SignedResponse<T>;
  if (!response.ok || json.retCode !== 0) {
    // Bybit's message is safe to surface; it never contains key material.
    throw new Error(json.retMsg || `Bybit request failed (${response.status})`);
  }
  return json.result;
}

export async function fetchSpotFeeRates(credentials: BybitCredentials) {
  const result = await request<{ list: Array<{ symbol: string; takerFeeRate: string; makerFeeRate: string }> }>(
    credentials,
    "GET",
    "/v5/account/fee-rate",
    { category: "spot" },
  );
  return result.list ?? [];
}

export async function fetchConvertQuote(
  credentials: BybitCredentials,
  input: { fromCoin: string; toCoin: string; amount: string },
) {
  const result = await request<{
    quoteTxId: string;
    fromCoin: string;
    toCoin: string;
    fromAmount: string;
    toAmount: string;
    exchangeRate?: string;
    expiredTime?: string;
  }>(credentials, "POST", "/v5/asset/exchange/quote-apply", {
    accountType: "eb_convert_uta",
    fromCoin: input.fromCoin,
    toCoin: input.toCoin,
    requestCoin: input.fromCoin,
    requestAmount: input.amount,
  });
  return result;
}
