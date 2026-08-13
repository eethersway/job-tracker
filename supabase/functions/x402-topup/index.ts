import { createClient } from "jsr:@supabase/supabase-js@2";

// x402 (https://github.com/coinbase/x402) credit top-up paid in USDC on Base.
// Flow: client POSTs without X-PAYMENT -> we reply 402 with payment requirements;
// client retries with X-PAYMENT (base64 payment payload) -> we verify + settle via
// the x402.org facilitator and grant credits.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-payment",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "x-payment-response",
};

const FACILITATOR = "https://x402.org/facilitator";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base mainnet

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

    const { data: payTo, error: secErr } = await supabase.rpc("get_secret", {
      k: "X402_PAY_TO_ADDRESS",
    });
    if (secErr || !payTo) {
      return json({ ok: false, error: "x402 not configured" }, 500);
    }

    // USDC has 6 decimals: 1 cent = 10^4 atomic units.
    const paymentRequirements = {
      scheme: "exact",
      network: "base",
      maxAmountRequired: String(amount_cents * 10_000),
      resource: req.url,
      description: "JobTracker credits top-up",
      mimeType: "application/json",
      payTo: payTo as string,
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

    const facilitatorBody = JSON.stringify({
      x402Version: 1,
      paymentPayload,
      paymentRequirements,
    });

    const verifyResp = await fetch(`${FACILITATOR}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: facilitatorBody,
    });
    const verify = await verifyResp.json().catch(() => ({}));
    if (!verifyResp.ok || !verify?.isValid) {
      return json({
        x402Version: 1,
        error: `Payment verification failed: ${verify?.invalidReason ?? `facilitator HTTP ${verifyResp.status}`}`,
        accepts: [paymentRequirements],
      }, 402);
    }

    const settleResp = await fetch(`${FACILITATOR}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: facilitatorBody,
    });
    const settle = await settleResp.json().catch(() => ({}));
    if (!settleResp.ok || !settle?.success) {
      return json({
        x402Version: 1,
        error: `Payment settlement failed: ${settle?.errorReason ?? `facilitator HTTP ${settleResp.status}`}`,
        accepts: [paymentRequirements],
      }, 402);
    }

    // Idempotency ref: on-chain tx hash, falling back to the payload's nonce.
    // deno-lint-ignore no-explicit-any
    const nonce = (paymentPayload as any)?.payload?.authorization?.nonce;
    const ref = settle.transaction || nonce || crypto.randomUUID();

    const { error: grantErr } = await supabase.rpc("grant_credits", {
      p_user_id: who.sub,
      p_amount_cents: amount_cents,
      p_kind: "purchase_x402",
      p_ref: String(ref),
    });
    if (grantErr) {
      return json({
        ok: false,
        error: `Payment settled but crediting failed - contact support with reference ${ref}`,
      }, 500);
    }

    return json({ ok: true, credited_cents: amount_cents, tx: settle.transaction ?? null });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
