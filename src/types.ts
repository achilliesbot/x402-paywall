// Public types for @achilliesbot/x402-paywall.

export interface PaymentRequirement {
  scheme: "exact";
  network: string;            // canonical EIP-155 network (e.g. "eip155:8453" for Base mainnet)
  amount: string;              // raw USDC amount, 6-decimal integer as string (e.g. "10000" = $0.01)
  asset: string;               // USDC contract address
  payTo: string;               // receiving wallet
  maxTimeoutSeconds?: number;
  extra?: { name?: string; version?: string };
}

export interface PaymentQuote {
  x402Version: number;
  error?: string;
  resource?: { url: string; description?: string; mimeType?: string };
  accepts: PaymentRequirement[];
}

export type Payer = (quote: PaymentQuote) => Promise<string>;

export interface PaywallConfig {
  /** Full URL the client should POST to. The endpoint is expected to respond 402 with an x402 v2 quote. */
  endpoint: string;
  /** Seller wallet address (receiver of USDC). Used for UI display when the endpoint hasn't been probed yet. */
  wallet?: string;
  /** Price preview in USDC (decimal string like "0.01"). Used for UI display only — the server's quote is authoritative. */
  price?: string;
  /** Payer implementation. Use bankrPayer({ apiKey }) for hosted signing or viemPayer({...}) for self-custody. */
  payer: Payer;
  /** Enforce that the server's quote uses this asset address. Defaults to USDC on Base. */
  requireAsset?: string;
  /** Enforce that the server's quote uses this network. Defaults to Base mainnet. */
  requireNetwork?: string;
  /** Optional fetch override for SSR / testing. */
  fetchImpl?: typeof fetch;
  /** Optional POST body that will be sent to the endpoint alongside the payment header. */
  body?: unknown;
  /** Optional extra request headers. */
  headers?: Record<string, string>;
}

export class PaywallError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly detail?: unknown;
  constructor(code: string, message: string, detail?: unknown, status?: number) {
    super(message);
    this.name = "PaywallError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export interface PaywallResult<Data = unknown> {
  /** Parsed JSON response from the server after payment settled. */
  data: Data | null;
  /** Raw Response object from the successful retry. */
  response: Response | null;
  /** Amount paid, in decimal USDC (e.g. "0.01"). */
  pricePaid: string | null;
  /** Receiving wallet that was actually paid to. */
  payTo: string | null;
  /** Opaque x402 transaction identifier if the server surfaces one. */
  transactionId: string | null;
}

export interface UseX402PaymentResult<Data = unknown> {
  data: Data | null;
  error: PaywallError | Error | null;
  loading: boolean;
  paid: boolean;
  pricePaid: string | null;
  pay: () => Promise<Data | null>;
  reset: () => void;
}

export const USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const BASE_MAINNET_NETWORK = "eip155:8453";
