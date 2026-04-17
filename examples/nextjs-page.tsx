// Example: Next.js App Router page gated by x402-paywall.
//
// Drop this file at app/pro/page.tsx and set NEXT_PUBLIC_BANKR_KEY in .env.
// The server at https://api.example.com/recipes/42 must reply 402 with an
// x402 v2 quote on unpaid requests.

"use client";

import { X402Paywall, bankrPayer } from "@achilliesbot/x402-paywall";

const payer = bankrPayer({
  apiKey: process.env.NEXT_PUBLIC_BANKR_KEY!,
});

export default function ProPage() {
  return (
    <main style={{ maxWidth: 640, margin: "40px auto" }}>
      <h1>Recipe #42</h1>
      <X402Paywall
        endpoint="https://api.example.com/recipes/42"
        payer={payer}
        price="0.01"
        wallet="0x069c6012E053DFBf50390B19FaE275aD96D22ed7"
      >
        {({ data, pricePaid }) => (
          <>
            <p style={{ color: "#38a169", font: "500 13px system-ui" }}>
              Unlocked — paid ${pricePaid} USDC.
            </p>
            <article
              dangerouslySetInnerHTML={{
                __html: (data as { html: string }).html,
              }}
            />
          </>
        )}
      </X402Paywall>
    </main>
  );
}
