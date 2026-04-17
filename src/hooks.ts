// React hook for programmatic x402 payment.

import { useCallback, useRef, useState } from "react";
import type {
  PaywallConfig,
  PaywallError,
  UseX402PaymentResult,
} from "./types.js";
import { callPaidEndpoint } from "./core.js";

export function useX402Payment<Data = unknown>(
  config: PaywallConfig,
): UseX402PaymentResult<Data> {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<PaywallError | Error | null>(null);
  const [loading, setLoading] = useState(false);
  const [paid, setPaid] = useState(false);
  const [pricePaid, setPricePaid] = useState<string | null>(null);

  // Keep the most recent config around without re-triggering memoized callbacks.
  const configRef = useRef(config);
  configRef.current = config;

  const pay = useCallback(async (): Promise<Data | null> => {
    setLoading(true);
    setError(null);
    try {
      const result = await callPaidEndpoint<Data>(configRef.current);
      setData(result.data);
      setPricePaid(result.pricePaid);
      setPaid(result.pricePaid !== null);
      return result.data;
    } catch (err) {
      const normalized =
        err instanceof Error ? err : new Error(String(err));
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
