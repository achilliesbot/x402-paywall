# @achilliesbot/x402-paywall

Drop-in React component kit and hook for gating any website behind USDC-on-Base x402 micropayments.

- `<X402Paywall>` — declarative component that hides content until the visitor pays
- `useX402Payment` — programmatic hook if you need custom UI
- `bankrPayer` — hosted signing via [BANKR Cloud](https://bankr.bot)
- `viemPayer` — self-custody signing via any viem `WalletClient`

Zero wallet-UX work. Zero custom retry logic. Paste, configure, ship.

## Install

```bash
npm install @achilliesbot/x402-paywall
# peer deps
npm install react
```

## 30-second example — BANKR hosted signing

```tsx
import { X402Paywall, bankrPayer } from "@achilliesbot/x402-paywall";

const payer = bankrPayer({ apiKey: process.env.NEXT_PUBLIC_BANKR_KEY! });

export default function ProRecipe() {
  return (
    <X402Paywall
      endpoint="https://api.example.com/recipes/42"
      payer={payer}
      price="0.01"
      wallet="0x069c6012E053DFBf50390B19FaE275aD96D22ed7"
    >
      {({ data }) => <article>{(data as { html: string }).html}</article>}
    </X402Paywall>
  );
}
```

That's it. The server responds 402 once with an x402 v2 quote, the component
runs the payer, retries with `X-Payment`, and renders `children` with the
parsed response.

## Self-custody with viem

```tsx
import { useWalletClient } from "wagmi";
import { X402Paywall, viemPayer } from "@achilliesbot/x402-paywall";

export default function Gated() {
  const { data: walletClient } = useWalletClient();
  if (!walletClient) return <ConnectButton />;

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
      {({ data }) => <pre>{JSON.stringify(data, null, 2)}</pre>}
    </X402Paywall>
  );
}
```

## Hook API (custom UI)

```tsx
import { useX402Payment, bankrPayer } from "@achilliesbot/x402-paywall";

const { pay, loading, paid, data, pricePaid, error } = useX402Payment({
  endpoint: "https://api.example.com/pro",
  payer: bankrPayer({ apiKey: "bk_..." }),
});

<button onClick={() => pay()} disabled={loading}>
  {paid ? `Paid $${pricePaid}` : loading ? "Paying…" : "Unlock"}
</button>;
```

## Programmatic (no React)

```ts
import { callPaidEndpoint, mockPayer } from "@achilliesbot/x402-paywall";

const result = await callPaidEndpoint({
  endpoint: "https://api.example.com/pro",
  payer: mockPayer(), // replace with bankrPayer/viemPayer in prod
});
console.log(result.data, result.pricePaid, result.payTo);
```

## Config reference

| Field            | Type              | Notes                                                                 |
| ---------------- | ----------------- | --------------------------------------------------------------------- |
| `endpoint`       | `string`          | Full URL the client POSTs to. Server must answer `402` on unpaid hit. |
| `payer`          | `Payer`           | `bankrPayer`, `viemPayer`, or your own `(quote) => Promise<header>`.  |
| `price`          | `string?`         | UI preview only — server quote is authoritative.                      |
| `wallet`         | `string?`         | UI preview only — shown in the default fallback card.                 |
| `requireAsset`   | `string?`         | Reject quotes that don't match. Defaults to USDC on Base.             |
| `requireNetwork` | `string?`         | Reject quotes that don't match. Defaults to `eip155:8453`.            |
| `body`           | `unknown?`        | Optional POST body sent alongside payment.                            |
| `headers`        | `Record<..,..>?`  | Extra request headers.                                                |
| `fetchImpl`      | `typeof fetch?`   | Override for SSR / tests.                                             |

## Security

- Only accepts x402 v2 `exact` scheme quotes.
- Validates that the server's quote matches `requireAsset` + `requireNetwork`
  before paying, so a compromised endpoint can't redirect payment to a new
  asset or chain.
- Never exposes the BANKR API key client-side unless you want it to — prefer
  proxying `bankrPayer` through your own backend for production deployments.

## License

MIT — see [LICENSE](./LICENSE).

Built by [Achilles](https://achillesalpha.onrender.com/ep).
