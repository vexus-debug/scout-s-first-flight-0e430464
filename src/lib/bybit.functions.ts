/**
 * Server functions exposing Bybit *account* data (fee tiers, Convert quotes).
 *
 * The API key/secret stay in the server runtime: handlers return only derived
 * numbers, never credentials. Callers get a `configured: false` shape when the
 * secrets are not set, so the UI can fall back to modelled values.
 */
import { createServerFn } from "@tanstack/react-start";

export type FeeRatesResult =
  | { configured: false; reason: string }
  | { configured: true; fetchedAt: string; defaultTaker: number; rates: Record<string, number> };

export type ConvertQuoteResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      fromCoin: string;
      toCoin: string;
      fromAmount: number;
      toAmount: number;
      rate: number;
      expiresAt: string | null;
    };

const toNumber = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const getBybitFeeRates = createServerFn({ method: "GET" }).handler(async (): Promise<FeeRatesResult> => {
  const { readBybitCredentials, fetchSpotFeeRates } = await import("./bybit.server");
  const credentials = readBybitCredentials();
  if (!credentials) {
    return { configured: false, reason: "Bybit API credentials are not configured on the server." };
  }

  try {
    const list = await fetchSpotFeeRates(credentials);
    const rates: Record<string, number> = {};
    let sum = 0;
    let count = 0;
    for (const item of list) {
      const taker = toNumber(item.takerFeeRate);
      if (taker <= 0) continue;
      rates[item.symbol] = taker;
      sum += taker;
      count += 1;
    }
    return {
      configured: true,
      fetchedAt: new Date().toISOString(),
      defaultTaker: count > 0 ? sum / count : 0.001,
      rates,
    };
  } catch (error) {
    return { configured: false, reason: error instanceof Error ? error.message : "Could not read Bybit fee rates." };
  }
});

export const getBybitConvertQuote = createServerFn({ method: "POST" })
  .inputValidator((input: { fromCoin: string; toCoin: string; amount: number }) => {
    const coin = /^[A-Z0-9]{2,16}$/;
    const fromCoin = String(input.fromCoin ?? "").toUpperCase();
    const toCoin = String(input.toCoin ?? "").toUpperCase();
    if (!coin.test(fromCoin) || !coin.test(toCoin) || fromCoin === toCoin) throw new Error("Invalid coin pair");
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) throw new Error("Invalid amount");
    return { fromCoin, toCoin, amount };
  })
  .handler(async ({ data }): Promise<ConvertQuoteResult> => {
    const { readBybitCredentials, fetchConvertQuote } = await import("./bybit.server");
    const credentials = readBybitCredentials();
    if (!credentials) {
      return { ok: false, reason: "Bybit API credentials are not configured on the server." };
    }

    try {
      const quote = await fetchConvertQuote(credentials, {
        fromCoin: data.fromCoin,
        toCoin: data.toCoin,
        amount: String(data.amount),
      });
      const fromAmount = toNumber(quote.fromAmount) || data.amount;
      const toAmount = toNumber(quote.toAmount);
      const rate = toNumber(quote.exchangeRate) || (fromAmount > 0 ? toAmount / fromAmount : 0);
      return {
        ok: true,
        fromCoin: quote.fromCoin ?? data.fromCoin,
        toCoin: quote.toCoin ?? data.toCoin,
        fromAmount,
        toAmount,
        rate,
        expiresAt: quote.expiredTime ? new Date(Number(quote.expiredTime)).toISOString() : null,
      };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "Could not fetch a Bybit Convert quote." };
    }
  });
