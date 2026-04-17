// Payer implementations for @achilliesbot/x402-paywall.
//
// A Payer is a function that takes a 402 quote and returns the base64-encoded
// X-Payment header the server will accept on retry.

import type { Payer, PaymentQuote, PaymentRequirement } from "./types.js";
import { PaywallError } from "./types.js";

export const USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const BASE_MAINNET_NETWORK = "eip155:8453";

export interface BankrPayerOptions {
  /** BANKR Cloud API key (bk_...). */
  apiKey: string;
  /** Override the BANKR pay endpoint. Defaults to the public facilitator. */
  endpoint?: string;
  /** fetch override (useful for SSR or testing). */
  fetchImpl?: typeof fetch;
}

/**
 * Hosted signing via BANKR Cloud. The BANKR wallet pays on the agent's behalf
 * and returns a settled X-Payment header that the gated endpoint will accept.
 */
export function bankrPayer(options: BankrPayerOptions): Payer {
  const endpoint = options.endpoint ?? "https://api.bankr.bot/x402/pay";
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  return async function pay(quote: PaymentQuote): Promise<string> {
    if (!fetchImpl) {
      throw new PaywallError(
        "NO_FETCH",
        "fetch is not available — pass fetchImpl to bankrPayer",
      );
    }

    const requirement = selectRequirement(quote);

    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": options.apiKey,
      },
      body: JSON.stringify({
        x402Version: quote.x402Version,
        accept: requirement,
        resource: quote.resource,
      }),
    });

    if (!response.ok) {
      const detail = await safeText(response);
      throw new PaywallError(
        "BANKR_PAY_FAILED",
        `BANKR payer failed with ${response.status}: ${detail.slice(0, 200)}`,
        detail,
        response.status,
      );
    }

    const body = (await response.json()) as {
      xPayment?: string;
      payment?: string;
    };
    const header = body.xPayment ?? body.payment;
    if (!header) {
      throw new PaywallError(
        "BANKR_PAY_NO_HEADER",
        "BANKR payer returned no payment header",
        body,
      );
    }
    return header;
  };
}

export interface ViemPayerOptions {
  /** viem WalletClient (or any object exposing signTypedData). */
  walletClient?: unknown;
  /** Optional callback, used instead of walletClient.signTypedData if provided. */
  signTypedData?: (args: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<string>;
  /** Connected account address — must match the EIP-3009 `from` field. */
  account: `0x${string}`;
  /** How far in the past the authorization should be valid from. Default 60s. */
  validAfterSeconds?: number;
  /** How long the authorization should remain valid. Default 600s. */
  validBeforeSeconds?: number;
}

/**
 * Self-custody signing via viem. Produces an EIP-3009
 * `TransferWithAuthorization` signature and encodes it as the x402 v2 payload.
 */
export function viemPayer(options: ViemPayerOptions): Payer {
  return async function pay(quote: PaymentQuote): Promise<string> {
    const requirement = selectRequirement(quote);
    if (requirement.scheme !== "exact") {
      throw new PaywallError(
        "UNSUPPORTED_SCHEME",
        `viemPayer only supports 'exact' scheme, got '${requirement.scheme}'`,
      );
    }
    if (!requirement.network.startsWith("eip155:")) {
      throw new PaywallError(
        "UNSUPPORTED_NETWORK",
        `viemPayer only supports EIP-155 networks, got '${requirement.network}'`,
      );
    }

    const chainId = Number.parseInt(
      requirement.network.split(":")[1] ?? "0",
      10,
    );
    const nonce = generateNonce();
    const now = Math.floor(Date.now() / 1000);
    const validAfter = String(now - (options.validAfterSeconds ?? 60));
    const validBefore = String(now + (options.validBeforeSeconds ?? 600));

    const usdcName = requirement.extra?.name ?? "USD Coin";
    const usdcVersion = requirement.extra?.version ?? "2";

    const message = {
      from: options.account,
      to: requirement.payTo as `0x${string}`,
      value: requirement.amount,
      validAfter,
      validBefore,
      nonce,
    };

    const typedData = {
      domain: {
        name: usdcName,
        version: usdcVersion,
        chainId,
        verifyingContract: requirement.asset as `0x${string}`,
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message,
    };

    let signature: string;
    if (options.signTypedData) {
      signature = await options.signTypedData(typedData);
    } else {
      const wallet = options.walletClient as {
        signTypedData?: (args: typeof typedData) => Promise<string>;
      } | undefined;
      if (!wallet?.signTypedData) {
        throw new PaywallError(
          "NO_SIGNER",
          "viemPayer: walletClient must have signTypedData, or pass signTypedData callback",
        );
      }
      signature = await wallet.signTypedData(typedData);
    }

    const payload = {
      x402Version: quote.x402Version,
      scheme: requirement.scheme,
      network: requirement.network,
      payload: {
        signature,
        authorization: message,
      },
    };

    return toBase64(JSON.stringify(payload));
  };
}

/** Test helper — returns a fixed header. Never use in production. */
export function mockPayer(header = "mock-payment-header"): Payer {
  return async function pay(_quote: PaymentQuote): Promise<string> {
    return header;
  };
}

/**
 * Picks the best payment requirement from a quote. Prefers USDC-on-Base, falls
 * back to the first listed option. Exported so integrators can override.
 */
export function selectRequirement(quote: PaymentQuote): PaymentRequirement {
  const usdcOnBase = quote.accepts.find(
    (r) =>
      r.network === BASE_MAINNET_NETWORK &&
      r.asset.toLowerCase() === USDC_BASE_MAINNET.toLowerCase(),
  );
  const requirement = usdcOnBase ?? quote.accepts[0];
  if (!requirement) {
    throw new PaywallError(
      "NO_REQUIREMENT",
      "No payment requirement available in quote",
      quote,
    );
  }
  return requirement;
}

function generateNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return ("0x" +
    Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      "",
    )) as `0x${string}`;
}

function toBase64(input: string): string {
  if (typeof btoa === "function") return btoa(input);
  const nodeBuffer = (
    globalThis as {
      Buffer?: {
        from(s: string, enc: string): { toString(enc: string): string };
      };
    }
  ).Buffer;
  if (nodeBuffer) return nodeBuffer.from(input, "utf8").toString("base64");
  throw new PaywallError(
    "NO_BASE64",
    "No base64 encoder available (btoa/Buffer)",
  );
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
