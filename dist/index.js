// src/types.ts
var PaywallError = class extends Error {
  constructor(code, message, detail, status) {
    super(message);
    this.name = "PaywallError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
};
var USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
var BASE_MAINNET_NETWORK = "eip155:8453";

// src/payer.ts
var USDC_BASE_MAINNET2 = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
var BASE_MAINNET_NETWORK2 = "eip155:8453";
function bankrPayer(options) {
  const endpoint = options.endpoint ?? "https://api.bankr.bot/x402/pay";
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  return async function pay(quote) {
    if (!fetchImpl) {
      throw new PaywallError(
        "NO_FETCH",
        "fetch is not available \u2014 pass fetchImpl to bankrPayer"
      );
    }
    const requirement = selectRequirement(quote);
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": options.apiKey
      },
      body: JSON.stringify({
        x402Version: quote.x402Version,
        accept: requirement,
        resource: quote.resource
      })
    });
    if (!response.ok) {
      const detail = await safeText(response);
      throw new PaywallError(
        "BANKR_PAY_FAILED",
        `BANKR payer failed with ${response.status}: ${detail.slice(0, 200)}`,
        detail,
        response.status
      );
    }
    const body = await response.json();
    const header = body.xPayment ?? body.payment;
    if (!header) {
      throw new PaywallError(
        "BANKR_PAY_NO_HEADER",
        "BANKR payer returned no payment header",
        body
      );
    }
    return header;
  };
}
function viemPayer(options) {
  return async function pay(quote) {
    const requirement = selectRequirement(quote);
    if (requirement.scheme !== "exact") {
      throw new PaywallError(
        "UNSUPPORTED_SCHEME",
        `viemPayer only supports 'exact' scheme, got '${requirement.scheme}'`
      );
    }
    if (!requirement.network.startsWith("eip155:")) {
      throw new PaywallError(
        "UNSUPPORTED_NETWORK",
        `viemPayer only supports EIP-155 networks, got '${requirement.network}'`
      );
    }
    const chainId = Number.parseInt(
      requirement.network.split(":")[1] ?? "0",
      10
    );
    const nonce = generateNonce();
    const now = Math.floor(Date.now() / 1e3);
    const validAfter = String(now - (options.validAfterSeconds ?? 60));
    const validBefore = String(now + (options.validBeforeSeconds ?? 600));
    const usdcName = requirement.extra?.name ?? "USD Coin";
    const usdcVersion = requirement.extra?.version ?? "2";
    const message = {
      from: options.account,
      to: requirement.payTo,
      value: requirement.amount,
      validAfter,
      validBefore,
      nonce
    };
    const typedData = {
      domain: {
        name: usdcName,
        version: usdcVersion,
        chainId,
        verifyingContract: requirement.asset
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" }
        ]
      },
      primaryType: "TransferWithAuthorization",
      message
    };
    let signature;
    if (options.signTypedData) {
      signature = await options.signTypedData(typedData);
    } else {
      const wallet = options.walletClient;
      if (!wallet?.signTypedData) {
        throw new PaywallError(
          "NO_SIGNER",
          "viemPayer: walletClient must have signTypedData, or pass signTypedData callback"
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
        authorization: message
      }
    };
    return toBase64(JSON.stringify(payload));
  };
}
function mockPayer(header = "mock-payment-header") {
  return async function pay(_quote) {
    return header;
  };
}
function selectRequirement(quote) {
  const usdcOnBase = quote.accepts.find(
    (r) => r.network === BASE_MAINNET_NETWORK2 && r.asset.toLowerCase() === USDC_BASE_MAINNET2.toLowerCase()
  );
  const requirement = usdcOnBase ?? quote.accepts[0];
  if (!requirement) {
    throw new PaywallError(
      "NO_REQUIREMENT",
      "No payment requirement available in quote",
      quote
    );
  }
  return requirement;
}
function generateNonce() {
  const bytes = new Uint8Array(32);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    ""
  );
}
function toBase64(input) {
  if (typeof btoa === "function") return btoa(input);
  const nodeBuffer = globalThis.Buffer;
  if (nodeBuffer) return nodeBuffer.from(input, "utf8").toString("base64");
  throw new PaywallError(
    "NO_BASE64",
    "No base64 encoder available (btoa/Buffer)"
  );
}
async function safeText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

// src/core.ts
async function callPaidEndpoint(config) {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new PaywallError(
      "NO_FETCH",
      "fetch is not available in this environment \u2014 pass fetchImpl in PaywallConfig"
    );
  }
  const body = config.body === void 0 ? void 0 : JSON.stringify(config.body);
  const baseHeaders = {
    ...config.headers ?? {}
  };
  if (body !== void 0) baseHeaders["Content-Type"] = "application/json";
  const firstResponse = await fetchImpl(config.endpoint, {
    method: "POST",
    headers: baseHeaders,
    body
  });
  if (firstResponse.status !== 402) {
    return await finalize(firstResponse, null);
  }
  const quote = await firstResponse.json();
  if (!quote.accepts || quote.accepts.length === 0) {
    throw new PaywallError(
      "NO_PAYMENT_QUOTE",
      "402 response missing payment requirements",
      quote,
      402
    );
  }
  assertQuoteMatchesConfig(quote, config);
  const requirement = selectRequirement(quote);
  const pricePaid = formatUsdc(requirement.amount);
  const paymentHeader = await config.payer(quote);
  const paidResponse = await fetchImpl(config.endpoint, {
    method: "POST",
    headers: { ...baseHeaders, "X-Payment": paymentHeader },
    body
  });
  if (!paidResponse.ok) {
    const errBody = await safeJson(paidResponse);
    throw new PaywallError(
      `HTTP_${paidResponse.status}`,
      `Payment accepted but endpoint returned ${paidResponse.status}`,
      errBody,
      paidResponse.status
    );
  }
  return await finalize(paidResponse, {
    pricePaid,
    payTo: requirement.payTo
  });
}
async function finalize(response, payment) {
  let data = null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    data = await safeJson(response);
  }
  const transactionId = response.headers.get("x-payment-response") ?? response.headers.get("x-payment-txid") ?? response.headers.get("x-transaction-id") ?? null;
  return {
    data,
    response,
    pricePaid: payment?.pricePaid ?? null,
    payTo: payment?.payTo ?? null,
    transactionId
  };
}
function assertQuoteMatchesConfig(quote, config) {
  const expectedNetwork = config.requireNetwork ?? BASE_MAINNET_NETWORK2;
  const expectedAsset = (config.requireAsset ?? USDC_BASE_MAINNET2).toLowerCase();
  const match = quote.accepts.find(
    (r) => r.network === expectedNetwork && r.asset.toLowerCase() === expectedAsset
  );
  if (!match) {
    throw new PaywallError(
      "QUOTE_MISMATCH",
      `Server quote did not include required network=${expectedNetwork} asset=${expectedAsset}`,
      quote,
      402
    );
  }
}
function formatUsdc(raw) {
  if (!/^\d+$/.test(raw)) return raw;
  const padded = raw.padStart(7, "0");
  const whole = padded.slice(0, -6);
  const fraction = padded.slice(-6).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
async function safeJson(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

// src/hooks.ts
import { useCallback, useRef, useState } from "react";
function useX402Payment(config) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [paid, setPaid] = useState(false);
  const [pricePaid, setPricePaid] = useState(null);
  const configRef = useRef(config);
  configRef.current = config;
  const pay = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await callPaidEndpoint(configRef.current);
      setData(result.data);
      setPricePaid(result.pricePaid);
      setPaid(result.pricePaid !== null);
      return result.data;
    } catch (err) {
      const normalized = err instanceof Error ? err : new Error(String(err));
      setError(normalized);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);
  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
    setPaid(false);
    setPricePaid(null);
  }, []);
  return { data, error, loading, paid, pricePaid, pay, reset };
}

// src/paywall.tsx
import { createElement, useMemo } from "react";
function X402Paywall(props) {
  const {
    children,
    fallback,
    autoPay: _autoPay,
    ...config
  } = props;
  const memoConfig = useMemo(
    () => config,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      config.endpoint,
      config.payer,
      config.wallet,
      config.price,
      config.requireAsset,
      config.requireNetwork,
      config.fetchImpl,
      JSON.stringify(config.body ?? null),
      JSON.stringify(config.headers ?? null)
    ]
  );
  const state = useX402Payment(memoConfig);
  if (state.paid && state.data !== null) {
    return children(state);
  }
  if (fallback) return fallback(state);
  return createElement(DefaultPaywallUI, {
    state,
    wallet: config.wallet,
    price: config.price
  });
}
function PayButton(props) {
  const { state, label, className, style } = props;
  const text = state.loading ? "Paying\u2026" : state.error ? "Retry payment" : label ?? "Pay with USDC";
  return createElement(
    "button",
    {
      type: "button",
      onClick: () => {
        void state.pay();
      },
      disabled: state.loading,
      className,
      style: {
        padding: "10px 18px",
        borderRadius: 8,
        border: "1px solid #2b6cb0",
        background: state.loading ? "#8fb3d9" : "#2b6cb0",
        color: "white",
        font: "600 14px/1.2 system-ui, sans-serif",
        cursor: state.loading ? "wait" : "pointer",
        ...style
      }
    },
    text
  );
}
function DefaultPaywallUI(props) {
  const { state, wallet, price } = props;
  const rows = [];
  rows.push(
    createElement(
      "div",
      {
        key: "title",
        style: { font: "600 16px/1.3 system-ui", marginBottom: 4 }
      },
      "Paid content"
    )
  );
  if (price) {
    rows.push(
      createElement(
        "div",
        {
          key: "price",
          style: { font: "400 13px/1.4 system-ui", color: "#4a5568" }
        },
        `Price: $${price} USDC on Base`
      )
    );
  }
  if (wallet) {
    rows.push(
      createElement(
        "div",
        {
          key: "wallet",
          style: {
            font: "400 12px/1.4 ui-monospace, monospace",
            color: "#718096",
            wordBreak: "break-all"
          }
        },
        `Pays to ${wallet}`
      )
    );
  }
  rows.push(
    createElement(PayButton, { key: "btn", state })
  );
  if (state.error) {
    rows.push(
      createElement(
        "div",
        {
          key: "err",
          style: {
            font: "400 12px/1.4 system-ui",
            color: "#c53030",
            marginTop: 4
          }
        },
        state.error.message
      )
    );
  }
  return createElement(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 16,
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        background: "#f7fafc",
        maxWidth: 420
      }
    },
    rows
  );
}
export {
  BASE_MAINNET_NETWORK,
  PayButton,
  PaywallError,
  USDC_BASE_MAINNET,
  X402Paywall,
  bankrPayer,
  callPaidEndpoint,
  formatUsdc,
  mockPayer,
  selectRequirement,
  useX402Payment,
  viemPayer
};
