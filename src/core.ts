// Core 402-retry loop for @achilliesbot/x402-paywall.
//
// POST to the endpoint. If the server answers 402 with an x402 v2 quote,
// run the user's Payer, then retry the POST with the X-Payment header.

import type {
  PaymentQuote,
  PaywallConfig,
  PaywallResult,
} from "./types.js";
import { PaywallError } from "./types.js";
import {
  BASE_MAINNET_NETWORK,
  USDC_BASE_MAINNET,
  selectRequirement,
} from "./payer.js";

export async function callPaidEndpoint<Data = unknown>(
  config: PaywallConfig,
): Promise<PaywallResult<Data>> {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new PaywallError(
      "NO_FETCH",
      "fetch is not available in this environment — pass fetchImpl in PaywallConfig",
    );
  }

  const body = config.body === undefined ? undefined : JSON.stringify(config.body);
  const baseHeaders: Record<string, string> = {
    ...(config.headers ?? {}),
  };
  if (body !== undefined) baseHeaders["Content-Type"] = "application/json";

  const firstResponse = await fetchImpl(config.endpoint, {
    method: "POST",
    headers: baseHeaders,
    body,
  });

  if (firstResponse.status !== 402) {
    // No paywall — already public or already paid.
    return await finalize<Data>(firstResponse, null);
  }

  const quote = (await firstResponse.json()) as PaymentQuote;
  if (!quote.accepts || quote.accepts.length === 0) {
    throw new PaywallError(
      "NO_PAYMENT_QUOTE",
      "402 response missing payment requirements",
      quote,
      402,
    );
  }

  assertQuoteMatchesConfig(quote, config);

  const requirement = selectRequirement(quote);
  const pricePaid = formatUsdc(requirement.amount);

  const paymentHeader = await config.payer(quote);

  const paidResponse = await fetchImpl(config.endpoint, {
    method: "POST",
    headers: { ...baseHeaders, "X-Payment": paymentHeader },
    body,
  });

  if (!paidResponse.ok) {
    const errBody = await safeJson(paidResponse);
    throw new PaywallError(
      `HTTP_${paidResponse.status}`,
      `Payment accepted but endpoint returned ${paidResponse.status}`,
      errBody,
      paidResponse.status,
    );
  }

  return await finalize<Data>(paidResponse, {
    pricePaid,
    payTo: requirement.payTo,
  });
}

async function finalize<Data>(
  response: Response,
  payment: { pricePaid: string; payTo: string } | null,
): Promise<PaywallResult<Data>> {
  let data: Data | null = null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    data = (await safeJson(response)) as Data | null;
  }

  const transactionId =
    response.headers.get("x-payment-response") ??
    response.headers.get("x-payment-txid") ??
    response.headers.get("x-transaction-id") ??
    null;

  return {
    data,
    response,
    pricePaid: payment?.pricePaid ?? null,
    payTo: payment?.payTo ?? null,
    transactionId,
  };
}

function assertQuoteMatchesConfig(
  quote: PaymentQuote,
  config: PaywallConfig,
): void {
  const expectedNetwork = config.requireNetwork ?? BASE_MAINNET_NETWORK;
  const expectedAsset = (
    config.requireAsset ?? USDC_BASE_MAINNET
  ).toLowerCase();

  const match = quote.accepts.find(
    (r) =>
      r.network === expectedNetwork &&
      r.asset.toLowerCase() === expectedAsset,
  );
  if (!match) {
    throw new PaywallError(
      "QUOTE_MISMATCH",
      `Server quote did not include required network=${expectedNetwork} asset=${expectedAsset}`,
      quote,
      402,
    );
  }
}

/** Convert raw 6-decimal USDC amount string to a decimal string. */
export function formatUsdc(raw: string): string {
  if (!/^\d+$/.test(raw)) return raw;
  const padded = raw.padStart(7, "0");
  const whole = padded.slice(0, -6);
  const fraction = padded.slice(-6).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}
