// Example: self-custody signing with wagmi + viem. Pair with RainbowKit or
// ConnectKit — all we need is a WalletClient.

"use client";

import { useWalletClient } from "wagmi";
import { X402Paywall, viemPayer } from "@achilliesbot/x402-paywall";

export default function GatedViem() {
  const { data: walletClient } = useWalletClient();

  if (!walletClient?.account) {
    return <p>Connect a wallet to unlock.</p>;
  }

  const payer = viemPayer({
    walletClient,
    account: walletClient.account.address,
  });

  return (
    <X402Paywall
      endpoint="https://api.example.com/pro"
      payer={payer}
      price="0.05"
    >
      {({ data }) => (
        <pre style={{ padding: 12, background: "#0f172a", color: "#fef3c7" }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </X402Paywall>
  );
}
