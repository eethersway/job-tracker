import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-capture-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Identify the user by their personal capture token
    const token = (req.headers.get("x-capture-token") ?? "").trim();
    if (!token || token.length < 16) return json({ ok: false, error: "Missing capture token" }, 401);
    const { data: owner } = await supabase
      .from("profile")
      .select("user_id")
      .eq("capture_token", token)
      .maybeSingle();
    if (!owner) return json({ ok: false, error: "Invalid capture token - check the extension Options page against Settings in the app" }, 401);

    // Rate limit per user. Fails OPEN so a database hiccup does not block capture.
    try {
      const { data: allowed, error: rlErr } = await supabase.rpc("check_rate_limit", {
        p_user_id: owner.user_id,
        p_bucket: "capture",
        p_max: 100,
        p_window_seconds: 3600,
      });
      if (rlErr) {
        console.error(`capture-job: rate limit check failed: ${rlErr.message}`);
      } else if (allowed === false) {
        return json({ ok: false, error: "You are going too fast. Try again in a minute." }, 429);
      }
    } catch (e) {
      console.error(`capture-job: rate limit check threw: ${String((e as Error)?.message ?? e)}`);
    }

    const body = await req.json();
    const company_name = str(body.company_name);
    const job_title = str(body.job_title);
    if (!company_name || !job_title) {
      return json({ ok: false, error: "company_name and job_title are required" }, 400);
    }

    const { data, error } = await supabase
      .from("applications")
      .insert({
        user_id: owner.user_id,
        company_name,
        job_title,
        job_url: str(body.job_url),
        job_description: str(body.job_description),
        location: str(body.location),
        salary: str(body.salary),
        source: "extension",
        status: "new",
      })
      .select("id")
      .single();
    if (error) throw error;

    // Fire-and-forget: kick off company research in the background
    try {
      const p = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/research-company`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ application_id: data.id }),
      }).then(() => {}).catch(() => {});
      // deno-lint-ignore no-explicit-any
      (globalThis as any).EdgeRuntime?.waitUntil?.(p);
    } catch (_e) { /* research is best-effort */ }

    return json({ ok: true, id: data.id });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
