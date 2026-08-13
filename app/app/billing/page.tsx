"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/AppShell";
import { LoadingBlock, Spinner } from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { describeInvokeError } from "@/lib/generation";
import {
  COVER_LETTER_PRICE_CENTS,
  RESEARCH_PRICE_CENTS,
  RESUME_PRICE_CENTS,
  formatCents,
} from "@/lib/pricing";
import type {
  CreateCheckoutResponse,
  CreditTransaction,
  Profile,
} from "@/lib/types";

const NO_WALLET_MESSAGE =
  "Crypto top-up requires a browser wallet like MetaMask or Coinbase Wallet.";

/** Prettify a credit_transactions.kind value, e.g. "cover_letter" → "Cover letter". */
function prettifyKind(kind: string): string {
  const known: Record<string, string> = {
    stripe_topup: "Card top-up",
    x402_topup: "Crypto top-up (USDC)",
    research: "Company research",
    resume: "Tailored resume",
    cover_letter: "Cover letter",
  };
  if (known[kind]) return known[kind];
  const words = kind.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : kind;
}

export default function BillingPage() {
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);

  const [buyingPack, setBuyingPack] = useState<number | null>(null);

  // Crypto (x402) top-up state — all failures stay inside this section.
  const [cryptoAmount, setCryptoAmount] = useState(500);
  const [cryptoBusy, setCryptoBusy] = useState(false);
  const [cryptoError, setCryptoError] = useState<string | null>(null);

  const fetchBilling = useCallback(async () => {
    setLoadError(null);
    try {
      const supabase = createClient();
      const [profileRes, txRes] = await Promise.all([
        supabase.from("profile").select("*").maybeSingle(),
        supabase
          .from("credit_transactions")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(25),
      ]);
      if (profileRes.error) throw new Error(profileRes.error.message);
      setProfile((profileRes.data as Profile | null) ?? null);
      // A missing transactions table (backend still deploying) shouldn't
      // break the whole page — just show an empty list.
      if (!txRes.error) {
        setTransactions((txRes.data as CreditTransaction[]) ?? []);
      }
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load billing info."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchBilling();
  }, [fetchBilling]);

  // Handle ?success=1 / ?canceled=1 from the Stripe Checkout redirect.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const success = params.get("success") === "1";
      const canceled = params.get("canceled") === "1";
      if (success) {
        showToast("Payment successful — credits added to your balance.", "success");
        void fetchBilling();
      } else if (canceled) {
        showToast("Checkout canceled — you have not been charged.", "info");
      }
      if (success || canceled) {
        window.history.replaceState({}, "", "/billing");
      }
    } catch {
      /* URL handling must never break the page */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function buyPack(pack: 500 | 1000) {
    setBuyingPack(pack);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke(
        "create-checkout",
        { body: { pack } }
      );
      if (error) {
        const info = await describeInvokeError(error);
        throw new Error(info.message);
      }
      const result = data as CreateCheckoutResponse | null;
      if (!result?.ok || !result.url) {
        throw new Error(result?.error ?? "Checkout could not be created.");
      }
      window.location.href = result.url;
      // Keep the spinner on while the browser navigates to Stripe.
    } catch (err) {
      showToast(
        `Could not start checkout: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
        "error"
      );
      setBuyingPack(null);
    }
  }

  /**
   * x402 crypto top-up: dynamically import x402-fetch + viem, wrap the
   * injected wallet (window.ethereum) in a viem wallet client, and call the
   * x402-topup edge function through fetchWithPayment. The wrapped fetch
   * receives the 402 challenge (with its accepts[] payment requirements),
   * pays in USDC on Base via the wallet, and retries with an X-PAYMENT
   * header automatically.
   */
  async function payWithCrypto() {
    setCryptoBusy(true);
    setCryptoError(null);
    try {
      const injected = (
        window as unknown as {
          ethereum?: { request: (args: unknown) => Promise<unknown> };
        }
      ).ethereum;
      if (!injected) {
        setCryptoError(NO_WALLET_MESSAGE);
        return;
      }

      // Libraries are installed remotely by Vercel; if the dynamic import
      // fails (offline build, missing dep), degrade gracefully.
      let mods: [
        { wrapFetchWithPayment: unknown },
        { createWalletClient: unknown; custom: unknown },
        { base: unknown },
      ] | null = null;
      try {
        mods = await Promise.all([
          import("x402-fetch"),
          import("viem"),
          import("viem/chains"),
        ]);
      } catch {
        mods = null;
      }
      if (!mods) {
        setCryptoError(
          "Crypto payments are unavailable right now (payment libraries failed to load). Please use a card instead."
        );
        return;
      }
      const [x402, viem, chains] = mods;

      const accounts = (await injected.request({
        method: "eth_requestAccounts",
      })) as string[] | null;
      const account = accounts?.[0];
      if (!account) {
        setCryptoError(
          "No wallet account connected — approve the connection request in your wallet and try again."
        );
        return;
      }

      const createWalletClient = viem.createWalletClient as (
        opts: unknown
      ) => unknown;
      const custom = viem.custom as (provider: unknown) => unknown;
      const walletClient = createWalletClient({
        account,
        chain: chains.base,
        transport: custom(injected),
      });

      const wrapFetchWithPayment = x402.wrapFetchWithPayment as (
        f: typeof fetch,
        client: unknown
      ) => typeof fetch;
      const fetchWithPayment = wrapFetchWithPayment(
        window.fetch.bind(window),
        walletClient
      );

      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        setCryptoError("Your session has expired — sign in again to top up.");
        return;
      }

      const response = await fetchWithPayment(
        `${SUPABASE_URL}/functions/v1/x402-topup`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            apikey: SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ amount_cents: cryptoAmount }),
        }
      );
      if (!response.ok) {
        let message = `Payment failed (HTTP ${response.status}).`;
        try {
          const body = (await response.json()) as { error?: string } | null;
          if (body?.error) message = body.error;
        } catch {
          /* non-JSON error body */
        }
        throw new Error(message);
      }

      showToast(
        `Crypto top-up successful — ${formatCents(cryptoAmount)} added.`,
        "success"
      );
      await fetchBilling();
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      // Wallet rejections read better inline than as a scary toast.
      setCryptoError(
        /denied|rejected/i.test(message)
          ? "Payment canceled in your wallet."
          : `Crypto payment failed: ${message}`
      );
    } finally {
      setCryptoBusy(false);
    }
  }

  const hasKey = Boolean(profile?.anthropic_api_key);
  const balance = profile?.credits_cents ?? 0;

  const packButton =
    "inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-50";

  return (
    <AppShell>
      <h1 className="mb-6 text-xl font-semibold tracking-tight text-slate-100">
        Billing
      </h1>

      {loading ? (
        <LoadingBlock label="Loading billing info…" />
      ) : loadError ? (
        <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-6 text-center">
          <p className="text-sm text-red-300">
            Could not load billing info: {loadError}
          </p>
          <button
            onClick={() => {
              setLoading(true);
              void fetchBilling();
            }}
            className="mt-3 rounded-lg border border-slate-700 px-4 py-1.5 text-sm text-slate-300 transition hover:bg-slate-800"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Balance + plan */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
            <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
              <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Credit balance
              </h2>
              <p className="mt-2 text-4xl font-semibold tracking-tight text-slate-100">
                {formatCents(balance)}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                {hasKey
                  ? "Not currently used — your API key covers generations."
                  : "Spent on research and document generation."}
              </p>
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
              <h2 className="text-sm font-semibold text-slate-100">
                {hasKey
                  ? "You're on the free tier — using your own API key"
                  : "You're on pay-as-you-go credits"}
              </h2>
              {hasKey ? (
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  An Anthropic API key is saved in your{" "}
                  <Link
                    href="/settings"
                    className="text-sky-400 underline-offset-2 hover:underline"
                  >
                    Settings
                  </Link>
                  , so all company research and document generation is free —
                  requests run on your own key and never touch your credit
                  balance. Remove the key to switch to credits.
                </p>
              ) : (
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  No API key on your profile, so generations are charged to
                  your credit balance. Prefer free? Add your own Anthropic API
                  key in{" "}
                  <Link
                    href="/settings"
                    className="text-sky-400 underline-offset-2 hover:underline"
                  >
                    Settings
                  </Link>
                  .
                </p>
              )}
              <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
                <li>
                  Company research{" "}
                  <span className="font-medium text-slate-200">
                    {formatCents(RESEARCH_PRICE_CENTS)}
                  </span>
                </li>
                <li>
                  Tailored resume{" "}
                  <span className="font-medium text-slate-200">
                    {formatCents(RESUME_PRICE_CENTS)}
                  </span>
                </li>
                <li>
                  Cover letter{" "}
                  <span className="font-medium text-slate-200">
                    {formatCents(COVER_LETTER_PRICE_CENTS)}
                  </span>
                </li>
              </ul>
            </section>
          </div>

          {/* Buy credits (Stripe) */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-sm font-semibold text-slate-100">
              Buy credits
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Pay by card via Stripe. Credits never expire.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                onClick={() => void buyPack(500)}
                disabled={buyingPack !== null}
                className={packButton}
              >
                {buyingPack === 500 && <Spinner className="h-4 w-4" />}
                Buy $5
              </button>
              <button
                onClick={() => void buyPack(1000)}
                disabled={buyingPack !== null}
                className={packButton}
              >
                {buyingPack === 1000 && <Spinner className="h-4 w-4" />}
                Buy $10
              </button>
            </div>
          </section>

          {/* Crypto top-up (x402) */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-100">
                Pay with crypto (USDC on Base)
              </h2>
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
                Beta
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Top up straight from a browser wallet using the x402 payment
              protocol — no card required. You&apos;ll be asked to approve a
              USDC payment on the Base network.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <select
                value={cryptoAmount}
                onChange={(e) => setCryptoAmount(Number(e.target.value))}
                disabled={cryptoBusy}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-sky-500 disabled:opacity-50"
                aria-label="Crypto top-up amount"
              >
                <option value={100}>$1</option>
                <option value={500}>$5</option>
                <option value={1000}>$10</option>
              </select>
              <button
                onClick={() => void payWithCrypto()}
                disabled={cryptoBusy}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
              >
                {cryptoBusy && <Spinner className="h-4 w-4" />}
                {cryptoBusy ? "Waiting for wallet…" : "Pay with wallet"}
              </button>
            </div>
            {cryptoError && (
              <p
                role="alert"
                className="mt-3 max-w-2xl rounded-lg border border-amber-500/30 bg-amber-950/30 px-3 py-2 text-xs text-amber-200"
              >
                {cryptoError}
              </p>
            )}
          </section>

          {/* Transactions */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/40">
            <h2 className="border-b border-slate-800 px-6 py-4 text-sm font-semibold text-slate-100">
              Recent transactions
            </h2>
            {transactions.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-slate-500">
                No transactions yet — top up or run your first generation and
                it will show up here.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                        Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                        Type
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-400">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx) => (
                      <tr
                        key={tx.id}
                        className="border-b border-slate-800/60 last:border-b-0"
                      >
                        <td className="px-6 py-3 text-slate-400">
                          {formatDate(tx.created_at)}
                        </td>
                        <td className="px-6 py-3 text-slate-200">
                          {prettifyKind(tx.kind)}
                        </td>
                        <td
                          className={`px-6 py-3 text-right font-medium ${
                            tx.delta_cents >= 0
                              ? "text-emerald-400"
                              : "text-slate-300"
                          }`}
                        >
                          {tx.delta_cents >= 0 ? "+" : ""}
                          {formatCents(tx.delta_cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
