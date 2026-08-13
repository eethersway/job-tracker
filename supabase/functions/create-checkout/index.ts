import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

    const { pack } = await req.json();
    if (pack !== 500 && pack !== 1000) {
      return json({ ok: false, error: "pack must be 500 or 1000 (cents)" }, 400);
    }

    const { data: stripeKey, error: secErr } = await supabase.rpc("get_secret", {
      k: "STRIPE_SECRET_KEY",
    });
    if (secErr || !stripeKey) {
      return json({ ok: false, error: "Stripe is not configured yet" }, 500);
    }

    // Figure out where to send the user back to after checkout.
    let origin = req.headers.get("origin");
    if (!origin) {
      const ref = req.headers.get("referer");
      if (ref) {
        try {
          origin = new URL(ref).origin;
        } catch (_e) { /* ignore bad referer */ }
      }
    }
    if (!origin) origin = "https://strongerapplicant.com";

    const packName = pack === 500 ? "JobTracker credits ($5 pack)" : "JobTracker credits ($10 pack)";
    const form = new URLSearchParams({
      mode: "payment",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][product_data][name]": packName,
      "line_items[0][price_data][unit_amount]": String(pack),
      "line_items[0][quantity]": "1",
      "metadata[user_id]": who.sub,
      // The webhook only mints credits for sessions carrying this marker.
      "metadata[purpose]": "credits",
      success_url: `${origin}/billing?success=1`,
      cancel_url: `${origin}/billing?canceled=1`,
    });

    const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const session = await resp.json().catch(() => ({}));
    if (!resp.ok || !session?.url) {
      const msg = session?.error?.message ?? `HTTP ${resp.status}`;
      return json({ ok: false, error: `Stripe error: ${msg}` }, 502);
    }

    return json({ ok: true, url: session.url });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
