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

// Rate limiting. Fails OPEN: if the check itself errors the database is already
// in trouble and the rest of this function will fail anyway.
//
// NOTE: the check is applied to the APPLICATION OWNER even when the caller is
// service_role. capture-job and generate-document both invoke this function
// internally, and those calls spend the owner's credits, so they deliberately
// count against the owner's 'research' bucket too.
async function underLimit(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  bucket: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_user_id: userId,
      p_bucket: bucket,
      p_max: max,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.error(`research-company: rate limit check '${bucket}' failed: ${error.message}`);
      return true;
    }
    return data !== false;
  } catch (e) {
    console.error(`research-company: rate limit check '${bucket}' threw: ${String((e as Error)?.message ?? e)}`);
    return true;
  }
}

const TOO_FAST = "You are going too fast. Try again in a minute.";

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

    const { application_id } = await req.json();
    if (!application_id) return json({ ok: false, error: "application_id is required" }, 400);

    const { data: app, error: appErr } = await supabase
      .from("applications")
      .select("id, user_id, company_name, job_title, location, job_url")
      .eq("id", application_id)
      .single();
    if (appErr || !app) return json({ ok: false, error: "Application not found" }, 404);

    const who = caller(req);
    if (who.role !== "service_role" && who.sub !== app.user_id) {
      return json({ ok: false, error: "Not allowed" }, 403);
    }

    // Rate limit before any spending or AI work.
    if (!await underLimit(supabase, app.user_id, "research_burst", 5, 60)) {
      return json({ ok: false, error: TOO_FAST }, 429);
    }
    if (!await underLimit(supabase, app.user_id, "research", 30, 3600)) {
      return json({ ok: false, error: TOO_FAST }, 429);
    }

    const { data: prof } = await supabase
      .from("profile")
      .select("anthropic_api_key, credits_cents")
      .eq("user_id", app.user_id)
      .maybeSingle();

    // Billing: BYO key = free tier; otherwise use the central key and spend credits.
    const PRICE = 25; // cents
    let apiKey: string | null = prof?.anthropic_api_key ?? null;
    let charged = false;
    if (!apiKey) {
      const { data: centralKey, error: secErr } = await supabase.rpc("get_secret", {
        k: "CENTRAL_ANTHROPIC_KEY",
      });
      if (secErr || !centralKey) {
        return json({ ok: false, error: "Service is not configured (missing central AI key). Contact support." }, 500);
      }
      const { data: paid, error: spendErr } = await supabase.rpc("spend_credits", {
        p_user_id: app.user_id,
        p_amount_cents: PRICE,
        p_kind: "spend_research",
        p_ref: application_id,
      });
      if (spendErr) throw spendErr;
      if (!paid) {
        return json(
          { ok: false, error: "Not enough credits. Top up on the Billing page.", needed_cents: PRICE },
          402,
        );
      }
      charged = true;
      apiKey = centralKey as string;
    }

    // Refund the charge if anything after it fails. Fires at most once: the ref
    // is random per call, so a double refund would double-credit.
    let refunded = false;
    const refund = async () => {
      if (!charged || refunded) return;
      refunded = true;
      try {
        const { data: ok, error } = await supabase.rpc("grant_credits", {
          p_user_id: app.user_id,
          p_amount_cents: PRICE,
          p_kind: "refund",
          p_ref: `spend_research:${application_id}:${crypto.randomUUID()}`,
        });
        if (error || ok === false) {
          console.error(
            `research-company: REFUND FAILED for user ${app.user_id} application ${application_id} (${PRICE}c): ${error?.message ?? "grant_credits returned false"}`,
          );
        }
      } catch (e) {
        console.error(
          `research-company: REFUND THREW for user ${app.user_id} application ${application_id} (${PRICE}c): ${String((e as Error)?.message ?? e)}`,
        );
      }
    };

    // Everything below is post-charge: any failure must refund before returning.
    try {
    const prompt = `Research the company "${app.company_name}" using web search.\n` +
      `Context: they posted a job titled "${app.job_title}"${app.location ? ` in ${app.location}` : ""}.` +
      `${app.job_url ? ` Job posting URL: ${app.job_url}` : ""}\n\n` +
      `Find: what the company does, main products/services, employee count, industry, headquarters, funding history (stage, total raised, valuation, notable investors) or public-company status, and 2-3 recent news items.\n\n` +
      `Then output ONLY a JSON object inside <company_json></company_json> tags with these string keys (use null when unknown):\n` +
      `name, website, summary (2-3 sentences on what they do), size (e.g. "~500 employees"), industry, hq, funding (stage/total/investors in one line, or e.g. "Public (NYSE: X)"), products (main products in one line), recent_news (2-3 items separated by " | "), research_md (a thorough markdown brief, 300-500 words, with sections: ## Overview, ## Products, ## Size & Funding, ## Recent News, ## Why It Matters For This Role - the last one tailored to the job title above).`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 5000,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      await refund();
      return json({ ok: false, error: `Anthropic API ${resp.status}: ${errText.slice(0, 400)}` }, 502);
    }
    const result = await resp.json();
    const text = (result.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n");

    const match = text.match(/<company_json>([\s\S]*?)<\/company_json>/);
    if (!match) {
      await refund();
      return json({ ok: false, error: "Model did not return structured research; try again" }, 502);
    }
    let parsed;
    try {
      parsed = JSON.parse(match[1].trim());
    } catch (_e) {
      await refund();
      return json({ ok: false, error: "Could not parse research JSON; try again" }, 502);
    }

    const companyRow = {
      user_id: app.user_id,
      name: parsed.name || app.company_name,
      website: parsed.website ?? null,
      summary: parsed.summary ?? null,
      size: parsed.size ?? null,
      industry: parsed.industry ?? null,
      hq: parsed.hq ?? null,
      funding: parsed.funding ?? null,
      products: parsed.products ?? null,
      recent_news: parsed.recent_news ?? null,
      research_md: parsed.research_md ?? null,
      researched_at: new Date().toISOString(),
    };

    // Upsert by case-insensitive name, scoped to this user. The match is done in
    // JS on purpose: passing a model/user supplied name to .ilike() lets "%" and
    // "_" act as LIKE wildcards and overwrite an unrelated company row.
    const { data: candidates } = await supabase
      .from("companies")
      .select("id, name")
      .eq("user_id", app.user_id);
    const wanted = String(companyRow.name ?? "").trim().toLowerCase();
    const existing = (candidates ?? []).find(
      (c) => String(c.name ?? "").trim().toLowerCase() === wanted,
    ) ?? null;

    let company_id: string;
    if (existing) {
      const { error } = await supabase.from("companies").update(companyRow).eq("id", existing.id);
      if (error) throw error;
      company_id = existing.id;
    } else {
      const { data: inserted, error } = await supabase
        .from("companies")
        .insert(companyRow)
        .select("id")
        .single();
      if (error) throw error;
      company_id = inserted.id;
    }

    const { error: linkErr } = await supabase
      .from("applications")
      .update({ company_id })
      .eq("id", application_id);
    if (linkErr) throw linkErr;

    return json({ ok: true, company_id });
    } catch (e) {
      // Post-charge failure (db write, network, bad payload): give the money back.
      await refund();
      return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
    }
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
