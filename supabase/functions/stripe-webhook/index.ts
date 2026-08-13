import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

// Stripe calls this server-to-server; verify_jwt is FALSE and authentication is
// done by verifying the Stripe-Signature header against STRIPE_WEBHOOK_SECRET.
//
// A valid signature only proves the event came from Stripe, not that it is a
// session THIS app created for credits. Before minting credits we also require:
// currency usd, livemode matching our key mode, an allowed pack amount, and
// metadata.purpose === "credits" (set by create-checkout).
//
// Handled events:
//   checkout.session.completed      -> grant credits
//   charge.refunded                 -> claw back (no suspension)
//   charge.dispute.created          -> claw back + suspend
//   charge.dispute.funds_withdrawn  -> same, idempotent with the above
//
// USER RESOLUTION FOR CLAWBACKS. A refund/dispute event carries a charge, not
// our metadata, so we resolve the buyer in this order:
//   1. metadata.user_id on the event object itself (future-proofing)
//   2. a local zero-delta 'adjustment' ledger row with ref "pi:<payment_intent>",
//      written at credit time - no network needed
//   3. Stripe API: GET /v1/checkout/sessions?payment_intent=... -> metadata.user_id
//   4. the purchase_stripe ledger row for that session id
// Anything we cannot map is acknowledged (200) and logged with console.error;
// retrying would not help.

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
const ALLOWED_PACKS = [500, 1000]; // cents; must match create-checkout
const STRIPE_TIMEOUT_MS = 10000;

/** Read-only Stripe REST call. Returns null on any failure. */
async function stripeGet(path: string, key: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`https://api.stripe.com/v1/${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
    });
    if (!r.ok) {
      console.error(`stripe-webhook: Stripe GET ${path} returned ${r.status}`);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.error(`stripe-webhook: Stripe GET ${path} failed: ${String((e as Error)?.message ?? e)}`);
    return null;
  }
}

function idOf(v: unknown): string | null {
  if (typeof v === "string" && v) return v;
  if (v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string") {
    return (v as { id: string }).id;
  }
  return null;
}

async function resolveUser(
  supabase: SupabaseClient,
  stripeKey: string | null,
  opts: {
    metadata?: Record<string, unknown> | null;
    paymentIntent?: string | null;
    chargeId?: string | null;
  },
): Promise<{ userId: string | null; how: string }> {
  // 1. metadata on the event object
  const direct = opts.metadata?.user_id;
  if (typeof direct === "string" && direct) return { userId: direct, how: "object metadata" };

  let pi = opts.paymentIntent ?? null;

  // 2. local payment_intent -> user mapping written when we credited the purchase
  if (pi) {
    const { data } = await supabase
      .from("credit_transactions")
      .select("user_id")
      .eq("kind", "adjustment")
      .eq("ref", `pi:${pi}`)
      .limit(1);
    if (data && data.length && data[0].user_id) {
      return { userId: data[0].user_id, how: "ledger payment_intent mapping" };
    }
  }

  // 3. no payment_intent on the object: ask Stripe about the charge
  if (!pi && opts.chargeId && stripeKey) {
    const charge = await stripeGet(`charges/${encodeURIComponent(opts.chargeId)}`, stripeKey);
    const m = (charge?.metadata as Record<string, unknown> | undefined)?.user_id;
    if (typeof m === "string" && m) return { userId: m, how: "charge metadata" };
    pi = idOf(charge?.payment_intent);
    if (pi) {
      const { data } = await supabase
        .from("credit_transactions")
        .select("user_id")
        .eq("kind", "adjustment")
        .eq("ref", `pi:${pi}`)
        .limit(1);
      if (data && data.length && data[0].user_id) {
        return { userId: data[0].user_id, how: "ledger payment_intent mapping (via charge)" };
      }
    }
  }

  // 4. which checkout session owned this payment intent?
  if (pi && stripeKey) {
    const list = await stripeGet(
      `checkout/sessions?payment_intent=${encodeURIComponent(pi)}&limit=1`,
      stripeKey,
    );
    const session = (list?.data as Record<string, unknown>[] | undefined)?.[0];
    if (session) {
      const meta = session.metadata as Record<string, unknown> | undefined;
      // Never claw back against a session that was not one of our credit purchases.
      if (meta?.purpose && meta.purpose !== "credits") {
        return { userId: null, how: `session purpose is ${String(meta.purpose)}, not credits` };
      }
      if (typeof meta?.user_id === "string" && meta.user_id) {
        return { userId: meta.user_id, how: "checkout session metadata" };
      }
      const sessionId = idOf(session.id);
      if (sessionId) {
        const { data } = await supabase
          .from("credit_transactions")
          .select("user_id")
          .eq("kind", "purchase_stripe")
          .eq("ref", sessionId)
          .limit(1);
        if (data && data.length && data[0].user_id) {
          return { userId: data[0].user_id, how: "purchase ledger row for session" };
        }
      }
    }
  }

  return { userId: null, how: "unresolved" };
}

/** Shared clawback path for refunds and disputes. */
async function clawBack(
  supabase: SupabaseClient,
  args: {
    userId: string;
    amountCents: number;
    kind: "clawback_refund" | "clawback_dispute";
    ref: string;
    suspend: boolean;
  },
): Promise<Response> {
  const { userId, amountCents, kind, ref, suspend } = args;

  // Idempotency guard. credit_tx_clawback_ref_uniq enforces this at the DB level
  // too; this check keeps the normal replay path quiet instead of erroring.
  const { data: prior } = await supabase
    .from("credit_transactions")
    .select("delta_cents")
    .eq("kind", kind)
    .eq("ref", ref)
    .limit(1);
  if (prior && prior.length) {
    const already = Math.abs(prior[0].delta_cents ?? 0);
    if (amountCents > already) {
      console.error(
        `stripe-webhook: ${kind} ref ${ref} already clawed back ${already}c but Stripe now reports ${amountCents}c - the extra ${amountCents - already}c needs a manual adjustment`,
      );
    }
    return json({ received: true, ignored: "already_clawed_back" });
  }

  const { data: taken, error } = await supabase.rpc("debit_credits", {
    p_user_id: userId,
    p_amount_cents: amountCents,
    p_kind: kind,
    p_ref: ref,
    p_suspend: suspend,
  });

  if (error) {
    // Unique violation: a concurrent delivery won the race, treat as done.
    if ((error as { code?: string }).code === "23505") {
      return json({ received: true, ignored: "already_clawed_back" });
    }
    console.error(`stripe-webhook: debit_credits failed for ${kind} ref ${ref}: ${error.message}`);
    return json({ received: false, error: "Clawback failed" }, 500); // let Stripe retry
  }

  const took = Number(taken ?? 0);
  if (took < amountCents) {
    console.error(
      `stripe-webhook: ${kind} ref ${ref} user ${userId} - only ${took}c of ${amountCents}c recovered (balance floored at 0); shortfall ${amountCents - took}c`,
    );
  }
  if (suspend) {
    console.error(`stripe-webhook: account ${userId} SUSPENDED after ${kind} ref ${ref} (${amountCents}c)`);
  }
  return json({ received: true, clawed_back_cents: took, suspended: suspend });
}

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
    const obj = event?.data?.object ?? {};
    const { data: stripeKeyRaw } = await supabase.rpc("get_secret", { k: "STRIPE_SECRET_KEY" });
    const stripeKey = stripeKeyRaw ? String(stripeKeyRaw) : null;

    /* ------------------------- credit purchases ------------------------- */
    if (event?.type === "checkout.session.completed") {
      const session = obj;
      if (session.payment_status === "paid") {
        const userId = session.metadata?.user_id;
        const amount = session.amount_total;
        const sessionId = session.id;

        // Only sessions this app created for credits may mint credits.
        if (session.metadata?.purpose !== "credits") {
          console.error(`stripe-webhook: ignoring paid session ${sessionId} (metadata.purpose is not "credits")`);
          return json({ received: true, ignored: "purpose" });
        }

        if (session.currency !== "usd") {
          console.error(`stripe-webhook: ignoring paid session ${sessionId} (currency ${session.currency})`);
          return json({ received: true, ignored: "currency" });
        }

        // Test-mode events must not credit a live deployment, and vice versa.
        if (!stripeKey) {
          console.error(`stripe-webhook: cannot verify livemode for session ${sessionId} (STRIPE_SECRET_KEY not configured)`);
          return json({ received: true, ignored: "livemode" });
        }
        const expectLive = stripeKey.startsWith("sk_live_");
        if (session.livemode !== expectLive) {
          console.error(`stripe-webhook: ignoring session ${sessionId} (livemode ${session.livemode}, expected ${expectLive})`);
          return json({ received: true, ignored: "livemode" });
        }

        if (!Number.isInteger(amount) || !ALLOWED_PACKS.includes(amount)) {
          console.error(`stripe-webhook: ignoring session ${sessionId} (amount_total ${amount} is not an allowed pack)`);
          return json({ received: true, ignored: "amount" });
        }

        if (typeof userId !== "string" || !userId) {
          console.error(`stripe-webhook: PAID SESSION NOT CREDITED - session ${sessionId} has no usable metadata.user_id`);
          return json({ received: true, ignored: "user_id" });
        }

        // grant_credits is idempotent per (kind, ref), so Stripe retries are safe.
        const { data: granted, error: grantErr } = await supabase.rpc("grant_credits", {
          p_user_id: userId,
          p_amount_cents: amount,
          p_kind: "purchase_stripe",
          p_ref: sessionId,
        });
        if (grantErr) {
          console.error(`stripe-webhook: grant_credits errored for purchase_stripe ref ${sessionId}: ${grantErr.message}`);
          // Non-200 makes Stripe retry; the idempotent grant makes that safe.
          return json({ received: false, error: "Credit grant failed" }, 500);
        }
        if (granted === false) {
          // Already granted for this ref (normal on retry), or the RPC declined it.
          console.error(`stripe-webhook: grant_credits returned false for purchase_stripe ref ${sessionId} (user ${userId}, ${amount}c) - verify this payment was credited exactly once`);
        }

        // Record payment_intent -> user so a later refund/dispute can find the
        // buyer without calling Stripe. Zero delta, so it never moves the balance.
        const pi = idOf(session.payment_intent);
        if (pi) {
          const { data: existing } = await supabase
            .from("credit_transactions")
            .select("id")
            .eq("kind", "adjustment")
            .eq("ref", `pi:${pi}`)
            .limit(1);
          if (!existing || existing.length === 0) {
            const { error: mapErr } = await supabase.from("credit_transactions").insert({
              user_id: userId,
              delta_cents: 0,
              kind: "adjustment",
              ref: `pi:${pi}`,
            });
            if (mapErr) {
              console.error(`stripe-webhook: could not store payment_intent mapping pi:${pi} for user ${userId}: ${mapErr.message} (clawbacks will fall back to the Stripe API)`);
            }
          }
        } else {
          console.error(`stripe-webhook: session ${sessionId} has no payment_intent; clawbacks for it will rely on the Stripe API`);
        }
      }
      return json({ received: true });
    }

    /* ---------------------------- refunds ------------------------------- */
    if (event?.type === "charge.refunded") {
      const chargeId = idOf(obj.id);
      const amountRefunded = obj.amount_refunded;
      if (!chargeId || !Number.isInteger(amountRefunded) || amountRefunded <= 0) {
        console.error(`stripe-webhook: charge.refunded with unusable charge id/amount (${chargeId}, ${amountRefunded})`);
        return json({ received: true, ignored: "amount" });
      }
      const { userId, how } = await resolveUser(supabase, stripeKey, {
        metadata: obj.metadata ?? null,
        paymentIntent: idOf(obj.payment_intent),
        chargeId,
      });
      if (!userId) {
        console.error(`stripe-webhook: REFUND NOT CLAWED BACK - charge ${chargeId} (${amountRefunded}c) could not be mapped to a user (${how})`);
        return json({ received: true, ignored: "unmapped" });
      }
      return await clawBack(supabase, {
        userId,
        amountCents: amountRefunded,
        kind: "clawback_refund",
        ref: chargeId,
        suspend: false,
      });
    }

    /* ---------------------------- disputes ------------------------------ */
    if (event?.type === "charge.dispute.created" || event?.type === "charge.dispute.funds_withdrawn") {
      const disputeId = idOf(obj.id);
      const amount = obj.amount;
      if (!disputeId || !Number.isInteger(amount) || amount <= 0) {
        console.error(`stripe-webhook: ${event.type} with unusable dispute id/amount (${disputeId}, ${amount})`);
        return json({ received: true, ignored: "amount" });
      }
      const { userId, how } = await resolveUser(supabase, stripeKey, {
        metadata: obj.metadata ?? null,
        paymentIntent: idOf(obj.payment_intent),
        chargeId: idOf(obj.charge),
      });
      if (!userId) {
        console.error(`stripe-webhook: DISPUTE NOT CLAWED BACK - dispute ${disputeId} on charge ${idOf(obj.charge)} (${amount}c) could not be mapped to a user (${how})`);
        return json({ received: true, ignored: "unmapped" });
      }
      return await clawBack(supabase, {
        userId,
        amountCents: amount,
        kind: "clawback_dispute",
        ref: disputeId,
        suspend: true,
      });
    }

    // Valid signature: always acknowledge, including unhandled event types.
    return json({ received: true });
  } catch (e) {
    console.error("stripe-webhook failed:", String((e as Error)?.message ?? e));
    return json({ received: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
