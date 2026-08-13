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

// Hard rule: no em/en dashes anywhere in generated documents.
function stripDashes(s: string): string {
  return s
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s*–\s*/g, "-")
    .replace(/—/g, "-")
    .replace(/–/g, "-");
}

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

    const { application_id, type } = await req.json();
    if (!application_id || !type || !["resume", "cover_letter"].includes(type)) {
      return json({ ok: false, error: "application_id and type ('resume'|'cover_letter') are required" }, 400);
    }

    const loadApp = async () => {
      const { data } = await supabase
        .from("applications")
        .select("id, user_id, company_id, company_name, job_title, job_description, location")
        .eq("id", application_id)
        .single();
      return data;
    };
    let app = await loadApp();
    if (!app) return json({ ok: false, error: "Application not found" }, 404);

    const who = caller(req);
    if (who.role !== "service_role" && who.sub !== app.user_id) {
      return json({ ok: false, error: "Not allowed" }, 403);
    }

    if (!app.job_description) {
      return json({ ok: false, error: "This application has no job description yet - add one first." }, 400);
    }

    const { data: profile } = await supabase
      .from("profile")
      .select("*")
      .eq("user_id", app.user_id)
      .maybeSingle();
    if (!profile?.anthropic_api_key) {
      return json({ ok: false, error: "No Anthropic API key on file - add yours in Settings." }, 400);
    }
    if (!profile?.master_resume_md) {
      return json({ ok: false, error: "No master resume found - fill out Settings first." }, 400);
    }
    const apiKey = profile.anthropic_api_key;

    // --- Research-first: ensure company research exists before generating ---
    const loadResearch = async () => {
      if (!app!.company_id) return null;
      const { data: co } = await supabase
        .from("companies")
        .select("summary, products, funding, size, research_md")
        .eq("id", app!.company_id)
        .single();
      return co ?? null;
    };
    let company = await loadResearch();
    if (!company?.research_md) {
      try {
        const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/research-company`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({ application_id }),
        });
        if (r.ok) {
          app = await loadApp();
          company = await loadResearch();
        }
      } catch (_e) { /* proceed without research rather than failing */ }
    }
    const research = company?.research_md || company?.summary || "";

    const contactLines = [
      profile.full_name ? `Name: ${profile.full_name}` : null,
      profile.location ? `Location: ${profile.location}` : null,
      profile.phone ? `Phone: ${profile.phone}` : null,
      profile.linkedin_url ? `LinkedIn: ${profile.linkedin_url}` : null,
      profile.email ? `Email: ${profile.email}` : null,
      profile.website ? `Website: ${profile.website}` : null,
    ].filter(Boolean).join("\n");

    const common =
      `# Job\nCompany: ${app!.company_name}\nTitle: ${app!.job_title}${app!.location ? `\nLocation: ${app!.location}` : ""}\n\n` +
      `# Job Description\n${app!.job_description}\n\n` +
      `# Candidate Contact Info\n${contactLines || "(none provided)"}\n\n` +
      `# Candidate Master Resume (SOURCE OF TRUTH for employers, titles, dates, education - never invent any of these)\n${profile.master_resume_md}\n` +
      (profile.highlights_md ? `\n# Career Highlights & Numbers (verified achievements - use these to strengthen bullets)\n${profile.highlights_md}\n` : "") +
      (profile.skills_md ? `\n# Skills & Tools\n${profile.skills_md}\n` : "") +
      (profile.extra_context_md ? `\n# Extra Context From The Candidate (follow any preferences stated here)\n${profile.extra_context_md}\n` : "") +
      (research ? `\n# Company Research\n${research}\n` : "");

    const prompt = type === "resume"
      ? `${common}\n# Task\nProduce (A) a tailored resume for this specific job and (B) a short "Call outs" fit assessment.\n\nHard rules for the resume (all mandatory):\n1. NEVER use em dashes or en dashes anywhere. Use commas, colons, or hyphens instead.\n2. Only include experience RELEVANT to this job. Omit or heavily compress unrelated roles rather than listing everything.\n3. Every bullet should lead with achievements and concrete numbers where available (use the Career Highlights section; never invent numbers).\n4. The header must always include: name, location, phone number, and LinkedIn profile URL. Include email/website if provided.\n5. Include a SKILLS & TOOLS section ONLY if this is a technical role (engineering, data, IT, or a role whose description emphasizes specific technical tools). For sales/BD/non-technical roles, weave relevant tools into experience bullets instead.\n6. Keep employers, titles, and dates exactly as in the master resume. Never fabricate experience, metrics, or credentials.\n7. Mirror the job description's language and keywords only where truthful.\n8. Use the Company Research where pertinent (e.g. angle the summary toward their market/products), but never claim experience with the company itself.\n9. Lead with a 2-3 line professional summary targeted at this exact role.\n10. Keep it to roughly 1 page of tight markdown (2 pages max for long careers).\n\nRules for Call outs: be brief and scannable, max 6 bullets total, one line each. Cover: overall fit (Strong / Moderate / Stretch, with a few words why), 2-3 strongest matches to emphasize, 1-2 gaps or risks and how to handle them. No em dashes. No fluff.\n\nOutput format - EXACTLY this structure, nothing else:\n<resume>\n...resume markdown...\n</resume>\n<callouts>\n...callouts markdown...\n</callouts>`
      : `${common}\n# Task\nWrite a compelling cover letter (250-350 words) for this job.\n\nHard rules (all mandatory):\n1. NEVER use em dashes or en dashes anywhere. Use commas, colons, or hyphens instead.\n2. Specific, not generic: reference concrete details about the company (from the research if provided, or the job description) and connect them to the candidate's actual experience.\n3. Use achievements and numbers from the Career Highlights where they fit naturally.\n4. Confident, warm, direct tone. No cliches ("I am writing to express...", "passionate", "dynamic"). Start with a hook.\n5. Never fabricate experience or claims.\n6. Sign off with the candidate's name${profile.full_name ? ` (${profile.full_name})` : ""}.\n\nOutput ONLY the cover letter in clean markdown - no preamble, no commentary.`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 4500,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return json({ ok: false, error: `Anthropic API ${resp.status}: ${errText.slice(0, 400)}` }, 502);
    }
    const result = await resp.json();
    const raw = (result.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n")
      .trim();
    if (!raw) return json({ ok: false, error: "Empty response from model; try again" }, 502);

    let content = raw;
    let callouts: string | null = null;
    if (type === "resume") {
      const rm = raw.match(/<resume>([\s\S]*?)<\/resume>/);
      const cm = raw.match(/<callouts>([\s\S]*?)<\/callouts>/);
      content = (rm ? rm[1] : raw).trim();
      callouts = cm ? stripDashes(cm[1].trim()) : null;
    }
    content = stripDashes(content).trim();

    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .insert({ application_id, user_id: app!.user_id, type, content_md: content })
      .select("id")
      .single();
    if (docErr) throw docErr;

    if (callouts) {
      await supabase.from("applications").update({ callouts_md: callouts }).eq("id", application_id);
    }

    return json({ ok: true, document_id: doc.id, has_callouts: !!callouts });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
