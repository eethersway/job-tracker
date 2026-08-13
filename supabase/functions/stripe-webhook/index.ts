import { createClient } from "jsr:@supabase/supabase-js@2";

// Stripe calls this server-to-server; verify_jwt is FALSE and authentication is
// done by verifying the Stripe-Signature header against STRIPE_WEBHOOK_SECRET.

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

const TOLERANCE_SECONDS = 300; // 5 minutes

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ received: false, error: "POST only" }, 405);
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: secret, error: secErr } = await supabase.rpc("get_secret", {
      k: "STRIPE_WEBHOOK_SECRET",
    });
    if (secErr || !secret) {
      return json({ received: false, error: "Stripe is not configured yet" }, 500);
    }

    const rawBody = await req.text();

    // Parse "t=...,v1=...,v1=..." (Stripe may send multiple v1 signatures during rotation).
    const header = req.headers.get("stripe-signature") ?? "";
    let t: string | null = null;
    const v1s: string[] = [];
    for (const part of header.split(",")) {
      const idx = part.indexOf("=");
      if (idx < 0) continue;
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k === "t") t = v;
      else if (k === "v1") v1s.push(v);
    }
    if (!t || v1s.length === 0) {
      return json({ received: false, error: "Malformed Stripe-Signature header" }, 400);
    }

    const ts = parseInt(t, 10);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) {
      return json({ received: false, error: "Signature timestamp outside tolerance" }, 400);
    }

    const expected = await hmacSha256Hex(secret as string, `${t}.${rawBody}`);
    const valid = v1s.some((v) => timingSafeEqual(expected, v));
    if (!valid) {
      return json({ received: false, error: "Invalid signature" }, 400);
    }

    const event = JSON.parse(rawBody);
    if (event?.type === "checkout.session.completed") {
      const session = event.data?.object ?? {};
      if (session.payment_status === "paid") {
        const userId = session.metadata?.user_id;
        const amount = session.amount_total;
        if (userId && Number.isInteger(amount) && amount > 0) {
          // grant_credits is idempotent per (kind, ref), so Stripe retries are safe.
          const { error: grantErr } = await supabase.rpc("grant_credits", {
            p_user_id: userId,
            p_amount_cents: amount,
            p_kind: "purchase_stripe",
            p_ref: session.id,
          });
          // Non-200 makes Stripe retry; the idempotent grant makes that safe.
          if (grantErr) return json({ received: false, error: "Credit grant failed" }, 500);
        }
      }
    }

    // Valid signature: always acknowledge, including unhandled event types.
    return json({ received: true });
  } catch (e) {
    return json({ received: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
