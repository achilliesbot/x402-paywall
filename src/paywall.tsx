// Declarative paywall component — render content only after the user pays.

import { createElement, useMemo } from "react";
import type { ReactNode } from "react";
import type { PaywallConfig, UseX402PaymentResult } from "./types.js";
import { useX402Payment } from "./hooks.js";

export interface X402PaywallProps<Data = unknown> extends PaywallConfig {
  /** Rendered after the user has paid and the server returns a 200. */
  children: (state: UseX402PaymentResult<Data>) => ReactNode;
  /** Rendered while the 402 quote has not been unlocked. */
  fallback?: (state: UseX402PaymentResult<Data>) => ReactNode;
  /** Optional: auto-trigger payment on first render instead of waiting for a click. */
  autoPay?: boolean;
}

/**
 * Gates arbitrary children behind an x402 POST request.
 *
 * Before payment, `fallback` is rendered (defaulting to a basic pay button).
 * After payment settles, `children` receives the full state including the
 * parsed response body.
 */
export function X402Paywall<Data = unknown>(
  props: X402PaywallProps<Data>,
): ReactNode {
  const {
    children,
    fallback,
    autoPay: _autoPay,
    ...config
  } = props;

  // Avoid a new hook config object every render if nothing meaningful changed.
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
      JSON.stringify(config.headers ?? null),
    ],
  );

  const state = useX402Payment<Data>(memoConfig);

  if (state.paid && state.data !== null) {
    return children(state);
  }
  if (fallback) return fallback(state);
  return createElement(DefaultPaywallUI, {
    state,
    wallet: config.wallet,
    price: config.price,
  });
}

export interface PayButtonProps<Data = unknown> {
  state: UseX402PaymentResult<Data>;
  label?: string;
  className?: string;
  style?: Record<string, string | number>;
}

/** Minimal pay-now button — calls `state.pay()` and shows loading / error states. */
export function PayButton<Data = unknown>(
  props: PayButtonProps<Data>,
): ReactNode {
  const { state, label, className, style } = props;
  const text = state.loading
    ? "Paying…"
    : state.error
      ? "Retry payment"
      : (label ?? "Pay with USDC");

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
        ...style,
      },
    },
    text,
  );
}

function DefaultPaywallUI(props: {
  state: UseX402PaymentResult<unknown>;
  wallet?: string;
  price?: string;
}): ReactNode {
  const { state, wallet, price } = props;
  const rows: ReactNode[] = [];

  rows.push(
    createElement(
      "div",
      {
        key: "title",
        style: { font: "600 16px/1.3 system-ui", marginBottom: 4 },
      },
      "Paid content",
    ),
  );

  if (price) {
    rows.push(
      createElement(
        "div",
        {
          key: "price",
          style: { font: "400 13px/1.4 system-ui", color: "#4a5568" },
        },
        `Price: $${price} USDC on Base`,
      ),
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
            wordBreak: "break-all",
          },
        },
        `Pays to ${wallet}`,
      ),
    );
  }

  rows.push(
    createElement(PayButton, { key: "btn", state }),
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
            marginTop: 4,
          },
        },
        state.error.message,
      ),
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
        maxWidth: 420,
      },
    },
    rows,
  );
}
