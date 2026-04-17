// Smoke tests for @achilliesbot/x402-paywall.
//
// Runs against the built dist/ (tsup output). Covers:
//   1. formatUsdc rounding
//   2. selectRequirement prefers USDC on Base
//   3. callPaidEndpoint executes 402 -> pay -> retry loop
//   4. requireAsset/requireNetwork rejects mismatched quote
//   5. mockPayer returns deterministic header

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");

const dist = await import(resolve(pkgRoot, "dist/index.js"));
const {
  formatUsdc,
  selectRequirement,
  callPaidEndpoint,
  mockPayer,
  USDC_BASE_MAINNET,
  BASE_MAINNET_NETWORK,
  PaywallError,
} = dist;

let failures = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok  ${name}`))
    .catch((err) => {
      failures++;
      console.error(`FAIL ${name}`);
      console.error(err?.stack ?? err);
    });
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

await test("formatUsdc: 10000 -> 0.01", () => {
  assert(formatUsdc("10000") === "0.01", formatUsdc("10000"));
  assert(formatUsdc("1000000") === "1", formatUsdc("1000000"));
  assert(formatUsdc("30000") === "0.03", formatUsdc("30000"));
  assert(formatUsdc("0") === "0", formatUsdc("0"));
});

await test("selectRequirement prefers USDC on Base", () => {
  const quote = {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: "eip155:1",
        amount: "10000",
        asset: "0xfake",
        payTo: "0x1",
      },
      {
        scheme: "exact",
        network: BASE_MAINNET_NETWORK,
        amount: "10000",
        asset: USDC_BASE_MAINNET,
        payTo: "0x2",
      },
    ],
  };
  const req = selectRequirement(quote);
  assert(req.payTo === "0x2", `got payTo=${req.payTo}`);
});

await test("callPaidEndpoint: 402 -> pay -> retry", async () => {
  let calls = 0;
  const fetchImpl = async (_url, init) => {
    calls++;
    if (calls === 1) {
      return new Response(
        JSON.stringify({
          x402Version: 2,
          accepts: [
            {
              scheme: "exact",
              network: BASE_MAINNET_NETWORK,
              amount: "30000",
              asset: USDC_BASE_MAINNET,
              payTo: "0x069c6012E053DFBf50390B19FaE275aD96D22ed7",
            },
          ],
        }),
        {
          status: 402,
          headers: { "content-type": "application/json" },
        },
      );
    }
    assert(init.headers["X-Payment"] === "mock-header", "X-Payment not set");
    return new Response(JSON.stringify({ ok: true, data: 42 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await callPaidEndpoint({
    endpoint: "https://example.com/pro",
    payer: mockPayer("mock-header"),
    fetchImpl,
  });

  assert(calls === 2, `expected 2 fetches, got ${calls}`);
  assert(result.data?.ok === true, "missing data.ok");
  assert(result.pricePaid === "0.03", `pricePaid=${result.pricePaid}`);
  assert(
    result.payTo === "0x069c6012E053DFBf50390B19FaE275aD96D22ed7",
    `payTo=${result.payTo}`,
  );
});

await test("requireAsset mismatch throws QUOTE_MISMATCH", async () => {
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        x402Version: 2,
        accepts: [
          {
            scheme: "exact",
            network: "eip155:1",
            amount: "10000",
            asset: "0x000000000000000000000000000000000000dead",
            payTo: "0x1",
          },
        ],
      }),
      { status: 402, headers: { "content-type": "application/json" } },
    );

  let threw = false;
  try {
    await callPaidEndpoint({
      endpoint: "https://example.com/pro",
      payer: mockPayer(),
      fetchImpl,
    });
  } catch (err) {
    threw = true;
    assert(err instanceof PaywallError, "not a PaywallError");
    assert(
      err.code === "QUOTE_MISMATCH",
      `expected QUOTE_MISMATCH, got ${err.code}`,
    );
  }
  assert(threw, "did not throw");
});

await test("callPaidEndpoint: non-402 passthrough", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ free: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const result = await callPaidEndpoint({
    endpoint: "https://example.com/free",
    payer: mockPayer(),
    fetchImpl,
  });
  assert(result.data?.free === true, "missing data.free");
  assert(result.pricePaid === null, "should not have charged");
});

// Verify package.json sanity
await test("package.json: name, types, exports", () => {
  const pkg = JSON.parse(
    readFileSync(resolve(pkgRoot, "package.json"), "utf8"),
  );
  assert(pkg.name === "@achilliesbot/x402-paywall", pkg.name);
  assert(pkg.main && pkg.module && pkg.types, "missing dist entries");
  assert(pkg.exports["."].import.endsWith(".js"), "missing import entry");
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log(`\nAll tests passed.`);
