import { createClient } from "jsr:@supabase/supabase-js@2";

// x402 (https://github.com/coinbase/x402) credit top-up paid in USDC on Base.
// Flow: client POSTs without X-PAYMENT -> we reply 402 with payment requirements;
// client retries with X-PAYMENT (base64 payment payload) -> we verify + settle via
// the x402.org facilitator, INDEPENDENTLY confirm the transfer on Base, then
// grant credits.
//
// We never take the facilitator's word for it: a compromised or buggy
// facilitator could report success without money moving. Before granting we
// read the transaction receipt from a public Base RPC and require a USDC
// Transfer log to the configured receiving address for at least the amount due.
// The grant ref is the on-chain tx hash, so credit_tx_purchase_ref_uniq blocks
// replay of the same payment.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-payment",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "x-payment-response",
};

const FACILITATOR = "https://x402.org/facilitator";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base mainnet
const BASE_RPC = "https://mainnet.base.org";
const BASE_CHAIN_ID = "0x2105"; // 8453
// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const NET_TIMEOUT_MS = 10000;
const RECEIPT_ATTEMPTS = 5;
const RECEIPT_DELAY_MS = 2000;
const USDC_UNITS_PER_CENT = 10_000n; // USDC has 6 decimals

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// verify_jwt=true already validated the signature; we only need the claims.
function caller(req: Request): { sub: string | null; role: string | null } {
  try {
    const t = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return { sub: payload.sub ?? null, role: payload.role ?? null };
  } catch (_e) {
    return { sub: null, role: null };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// deno-lint-ignore no-explicit-any
async function baseRpc(method: string, params: unknown[]): Promise<any> {
  const r = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(NET_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`Base RPC HTTP ${r.status}`);
  const j = await r.json();
  if (j?.error) throw new Error(`Base RPC error: ${j.error?.message ?? "unknown"}`);
  return j?.result;
}

/**
 * Independently confirm on Base that `txHash` moved at least `minAtomic` USDC
 * units to `payTo`. Sums every matching Transfer log in the transaction.
 */
async function verifyUsdcTransfer(
  txHash: string,
  payTo: string,
  minAtomic: bigint,
): Promise<{ ok: true; moved: bigint } | { ok: false; reason: string }> {
  let chainId: unknown;
  try {
    chainId = await baseRpc("eth_chainId", []);
  } catch (e) {
    return { ok: false, reason: `could not reach the Base network to verify the payment (${String((e as Error)?.message ?? e)})` };
  }
  if (String(chainId).toLowerCase() !== BASE_CHAIN_ID) {
    return { ok: false, reason: `payment RPC is not Base mainnet (chain id ${String(chainId)})` };
  }

  // deno-lint-ignore no-explicit-any
  let receipt: any = null;
  for (let i = 0; i < RECEIPT_ATTEMPTS; i++) {
    try {
      receipt = await baseRpc("eth_getTransactionReceipt", [txHash]);
    } catch (e) {
      return { ok: false, reason: `could not read the transaction receipt (${String((e as Error)?.message ?? e)})` };
    }
    if (receipt) break;
    if (i < RECEIPT_ATTEMPTS - 1) await sleep(RECEIPT_DELAY_MS);
  }
  if (!receipt) return { ok: false, reason: "transaction is not visible on Base yet" };
  if (String(receipt.status).toLowerCase() !== "0x1") {
    return { ok: false, reason: "the payment transaction failed on chain" };
  }

  const want = payTo.toLowerCase().replace(/^0x/, "");
  const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
  let moved = 0n;
  for (const log of logs) {
    if (String(log?.address ?? "").toLowerCase() !== USDC_BASE.toLowerCase()) continue;
    const topics = Array.isArray(log?.topics) ? log.topics : [];
    if (String(topics[0] ?? "").toLowerCase() !== TRANSFER_TOPIC) continue;
    // topics[2] is the indexed `to` address, left-padded to 32 bytes.
    const toTopic = String(topics[2] ?? "").toLowerCase().replace(/^0x/, "");
    if (toTopic.length !== 64 || toTopic.slice(24) !== want) continue;
    try {
      moved += BigInt(String(log?.data ?? "0x0"));
    } catch {
      continue;
    }
  }

  if (moved < minAtomic) {
    return {
      ok: false,
      reason: `the transaction moved ${moved} USDC units to the receiving address, but ${minAtomic} were required`,
    };
  }
  return { ok: true, moved };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const who = caller(req);
    if (!who.sub || who.role === "anon") {
      return json({ ok: false, error: "Sign in required" }, 401);
    }

    const { amount_cents } = await req.json();
    if (!Number.isInteger(amount_cents) || amount_cents < 100 || amount_cents > 10000) {
      return json({ ok: false, error: "amount_cents must be an integer between 100 and 10000" }, 400);
    }

    const { data: payToRaw, error: secErr } = await supabase.rpc("get_secret", {
      k: "X402_PAY_TO_ADDRESS",
    });
    if (secErr || !payToRaw) {
      return json({ ok: false, error: "x402 not configured" }, 500);
    }
    const payTo = String(payToRaw).trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(payTo)) {
      console.error("x402-topup: X402_PAY_TO_ADDRESS is not a valid 0x address");
      return json({ ok: false, error: "x402 not configured" }, 500);
    }

    const requiredAtomic = BigInt(amount_cents) * USDC_UNITS_PER_CENT;
    const paymentRequirements = {
      scheme: "exact",
      network: "base",
      maxAmountRequired: requiredAtomic.toString(),
      resource: req.url,
      description: "JobTracker credits top-up",
      mimeType: "application/json",
      payTo,
      maxTimeoutSeconds: 300,
      asset: USDC_BASE,
      extra: { name: "USD Coin", version: "2" },
    };

    const paymentHeader = req.headers.get("x-payment");
    if (!paymentHeader) {
      return json({
        x402Version: 1,
        error: "X-PAYMENT header is required",
        accepts: [paymentRequirements],
      }, 402);
    }

    let paymentPayload: unknown;
    try {
      paymentPayload = JSON.parse(atob(paymentHeader));
    } catch (_e) {
      return json({
        x402Version: 1,
        error: "Invalid X-PAYMENT header: expected base64-encoded JSON payment payload",
        accepts: [paymentRequirements],
      }, 402);
    }

    // The client must be paying on Base mainnet, not some other network.
    const payloadNetwork = (paymentPayload as { network?: unknown })?.network;
    if (payloadNetwork !== undefined && payloadNetwork !== "base") {
      return json({
        x402Version: 1,
        error: `Payment must be made on Base (got "${String(payloadNetwork)}")`,
        accepts: [paymentRequirements],
      }, 402);
    }

    const facilitatorBody = JSON.stringify({
      x402Version: 1,
      paymentPayload,
      paymentRequirements,
    });
    const facilitatorInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: facilitatorBody,
      signal: AbortSignal.timeout(NET_TIMEOUT_MS),
    };

    let verifyResp: Response;
    try {
      verifyResp = await fetch(`${FACILITATOR}/verify`, { ...facilitatorInit, signal: AbortSignal.timeout(NET_TIMEOUT_MS) });
    } catch (e) {
      return json({
        x402Version: 1,
        error: `Payment verification service unavailable (${String((e as Error)?.message ?? e)})`,
        accepts: [paymentRequirements],
      }, 402);
    }
    const verify = await verifyResp.json().catch(() => ({}));
    if (!verifyResp.ok || !verify?.isValid) {
      return json({
        x402Version: 1,
        error: `Payment verification failed: ${verify?.invalidReason ?? `facilitator HTTP ${verifyResp.status}`}`,
        accepts: [paymentRequirements],
      }, 402);
    }

    let settleResp: Response;
    try {
      settleResp = await fetch(`${FACILITATOR}/settle`, { ...facilitatorInit, signal: AbortSignal.timeout(NET_TIMEOUT_MS) });
    } catch (e) {
      return json({
        x402Version: 1,
        error: `Payment settlement service unavailable (${String((e as Error)?.message ?? e)})`,
        accepts: [paymentRequirements],
      }, 402);
    }
    const settle = await settleResp.json().catch(() => ({}));
    if (!settleResp.ok || settle?.success !== true) {
      return json({
        x402Version: 1,
        error: `Payment settlement failed: ${settle?.errorReason ?? `facilitator HTTP ${settleResp.status}`}`,
        accepts: [paymentRequirements],
      }, 402);
    }

    // Cross-check the network the facilitator says it settled on.
    if (settle.network !== undefined && settle.network !== "base") {
      console.error(`x402-topup: facilitator settled on network "${String(settle.network)}", expected base`);
      return json({
        x402Version: 1,
        error: `Payment settled on the wrong network ("${String(settle.network)}"); expected Base`,
        accepts: [paymentRequirements],
      }, 402);
    }

    // A real on-chain tx hash is mandatory: it is both the proof of payment and
    // the idempotency key. Never invent one.
    const txHash = typeof settle.transaction === "string" ? settle.transaction.trim() : "";
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      console.error(`x402-topup: settle reported success without a usable transaction hash (${JSON.stringify(settle.transaction ?? null)})`);
      return json({
        x402Version: 1,
        error: "Payment settled but no on-chain transaction hash was returned; nothing was credited",
        accepts: [paymentRequirements],
      }, 402);
    }

    // Independent on-chain confirmation before any credit is granted.
    const onChain = await verifyUsdcTransfer(txHash, payTo, requiredAtomic);
    if (!onChain.ok) {
      console.error(`x402-topup: on-chain verification failed for ${txHash}: ${onChain.reason}`);
      return json({
        x402Version: 1,
        error: `Could not confirm the payment on Base: ${onChain.reason}. Nothing was credited.`,
        transaction: txHash,
        accepts: [paymentRequirements],
      }, 402);
    }

    // Grant ref is the tx hash, so credit_tx_purchase_ref_uniq blocks replay.
    const { data: granted, error: grantErr } = await supabase.rpc("grant_credits", {
      p_user_id: who.sub,
      p_amount_cents: amount_cents,
      p_kind: "purchase_x402",
      p_ref: txHash,
    });
    if (grantErr) {
      console.error(`x402-topup: grant_credits failed for tx ${txHash} user ${who.sub}: ${grantErr.message}`);
      return json({
        ok: false,
        error: `Payment confirmed but crediting failed - contact support with reference ${txHash}`,
      }, 500);
    }
    if (granted === false) {
      // Same tx already credited: treat as a replay rather than a new top-up.
      console.error(`x402-topup: tx ${txHash} was already credited (replay attempt by user ${who.sub})`);
      return json({
        x402Version: 1,
        error: "This payment has already been credited.",
        transaction: txHash,
      }, 402);
    }

    return json({
      ok: true,
      credited_cents: amount_cents,
      transaction: txHash,
      usdc_units_received: onChain.moved.toString(),
    });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
