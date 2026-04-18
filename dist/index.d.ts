import { ReactNode } from 'react';

interface PaymentRequirement {
    scheme: "exact";
    network: string;
    amount: string;
    asset: string;
    payTo: string;
    maxTimeoutSeconds?: number;
    extra?: {
        name?: string;
        version?: string;
    };
}
interface PaymentQuote {
    x402Version: number;
    error?: string;
    resource?: {
        url: string;
        description?: string;
        mimeType?: string;
    };
    accepts: PaymentRequirement[];
}
type Payer = (quote: PaymentQuote) => Promise<string>;
interface PaywallConfig {
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
declare class PaywallError extends Error {
    readonly code: string;
    readonly status?: number;
    readonly detail?: unknown;
    constructor(code: string, message: string, detail?: unknown, status?: number);
}
interface PaywallResult<Data = unknown> {
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
interface UseX402PaymentResult<Data = unknown> {
    data: Data | null;
    error: PaywallError | Error | null;
    loading: boolean;
    paid: boolean;
    pricePaid: string | null;
    pay: () => Promise<Data | null>;
    reset: () => void;
}
declare const USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
declare const BASE_MAINNET_NETWORK = "eip155:8453";

interface BankrPayerOptions {
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
declare function bankrPayer(options: BankrPayerOptions): Payer;
interface ViemPayerOptions {
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
declare function viemPayer(options: ViemPayerOptions): Payer;
/** Test helper — returns a fixed header. Never use in production. */
declare function mockPayer(header?: string): Payer;
/**
 * Picks the best payment requirement from a quote. Prefers USDC-on-Base, falls
 * back to the first listed option. Exported so integrators can override.
 */
declare function selectRequirement(quote: PaymentQuote): PaymentRequirement;

declare function callPaidEndpoint<Data = unknown>(config: PaywallConfig): Promise<PaywallResult<Data>>;
/** Convert raw 6-decimal USDC amount string to a decimal string. */
declare function formatUsdc(raw: string): string;

declare function useX402Payment<Data = unknown>(config: PaywallConfig): UseX402PaymentResult<Data>;

interface X402PaywallProps<Data = unknown> extends PaywallConfig {
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
declare function X402Paywall<Data = unknown>(props: X402PaywallProps<Data>): ReactNode;
interface PayButtonProps<Data = unknown> {
    state: UseX402PaymentResult<Data>;
    label?: string;
    className?: string;
    style?: Record<string, string | number>;
}
/** Minimal pay-now button — calls `state.pay()` and shows loading / error states. */
declare function PayButton<Data = unknown>(props: PayButtonProps<Data>): ReactNode;

export { BASE_MAINNET_NETWORK, type BankrPayerOptions, PayButton, type PayButtonProps, type Payer, type PaymentQuote, type PaymentRequirement, type PaywallConfig, PaywallError, type PaywallResult, USDC_BASE_MAINNET, type UseX402PaymentResult, type ViemPayerOptions, X402Paywall, type X402PaywallProps, bankrPayer, callPaidEndpoint, formatUsdc, mockPayer, selectRequirement, useX402Payment, viemPayer };
