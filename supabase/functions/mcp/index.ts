import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

// JobTracker MCP server - Streamable HTTP transport, stateless JSON-RPC 2.0 over POST.
// verify_jwt is FALSE: auth is a JobTracker API token (profile.api_token) sent as
// "Authorization: Bearer <token>"; the matching row's user_id scopes ALL data access.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, mcp-protocol-version, mcp-session-id",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Expose-Headers": "mcp-protocol-version",
};

const PROTOCOL_VERSION = "2025-06-18";
const STATUSES = [
  "new",
  "applied",
  "screening",
  "interviewing",
  "negotiating",
  "accepted",
  "rejected",
  "declined",
  "ghosted",
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

// tools/call result helpers
function toolOk(data: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function toolErr(message: string) {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

const TOOLS = [
  {
    name: "list_applications",
    description:
      "List the user's job applications, newest first. Optionally filter by status or search by company name / job title.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: STATUSES, description: "Filter by application status" },
        search: { type: "string", description: "Case-insensitive match on company name or job title" },
        limit: { type: "number", description: "Max results (default 50, max 100)" },
      },
    },
  },
  {
    name: "get_application",
    description:
      "Get one application in full: all its fields, the company research (if researched), fit callouts, and counts of generated documents by type.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Application id (uuid)" } },
      required: ["id"],
    },
  },
  {
    name: "get_document",
    description:
      "Get the newest generated document (tailored resume or cover letter) for an application, as markdown.",
    inputSchema: {
      type: "object",
      properties: {
        application_id: { type: "string", description: "Application id (uuid)" },
        type: { type: "string", enum: ["resume", "cover_letter"] },
      },
      required: ["application_id", "type"],
    },
  },
  {
    name: "add_application",
    description: "Add a new job application to the tracker.",
    inputSchema: {
      type: "object",
      properties: {
        company_name: { type: "string" },
        job_title: { type: "string" },
        job_url: { type: "string" },
        job_description: { type: "string" },
        location: { type: "string" },
        salary: { type: "string" },
        status: { type: "string", enum: STATUSES, description: "Defaults to 'new'" },
      },
      required: ["company_name", "job_title"],
    },
  },
  {
    name: "update_application",
    description: "Update an existing application (status, notes, date applied, job description).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Application id (uuid)" },
        status: { type: "string", enum: STATUSES },
        notes: { type: "string" },
        date_applied: { type: "string", description: "Date in YYYY-MM-DD format" },
        job_description: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "get_profile",
    description:
      "Get the user's candidate profile: name, location, master resume, career highlights, skills, and extra context (all markdown).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_stats",
    description: "Get application counts by status plus the total.",
    inputSchema: { type: "object", properties: {} },
  },
];

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

async function callTool(
  supabase: SupabaseClient,
  uid: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "list_applications": {
      const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 100);
      let q = supabase
        .from("applications")
        .select("id, company_name, job_title, status, location, date_added, date_applied, company_id, job_url")
        .eq("user_id", uid)
        .order("date_added", { ascending: false })
        .limit(limit);
      const status = str(args.status);
      if (status) {
        if (!STATUSES.includes(status)) return toolErr(`Invalid status. Use one of: ${STATUSES.join(", ")}`);
        q = q.eq("status", status);
      }
      const search = str(args.search);
      if (search) {
        const s = search.replace(/[,%()]/g, " ").trim();
        if (s) q = q.or(`company_name.ilike.%${s}%,job_title.ilike.%${s}%`);
      }
      const { data, error } = await q;
      if (error) return toolErr(error.message);
      return toolOk(
        (data ?? []).map((a) => ({
          id: a.id,
          company_name: a.company_name,
          job_title: a.job_title,
          status: a.status,
          location: a.location,
          date_added: a.date_added,
          date_applied: a.date_applied,
          has_research: a.company_id !== null,
          url: a.job_url,
        })),
      );
    }

    case "get_application": {
      const id = str(args.id);
      if (!id) return toolErr("id is required");
      const { data: app, error } = await supabase
        .from("applications")
        .select("*")
        .eq("user_id", uid)
        .eq("id", id)
        .maybeSingle();
      if (error) return toolErr(error.message);
      if (!app) return toolErr("Application not found");

      let company = null;
      if (app.company_id) {
        const { data: co } = await supabase
          .from("companies")
          .select("summary, size, industry, hq, funding, products, recent_news, research_md")
          .eq("user_id", uid)
          .eq("id", app.company_id)
          .maybeSingle();
        company = co ?? null;
      }

      const { data: docs } = await supabase
        .from("documents")
        .select("type")
        .eq("user_id", uid)
        .eq("application_id", id);
      const document_counts: Record<string, number> = {};
      for (const d of docs ?? []) {
        document_counts[d.type] = (document_counts[d.type] ?? 0) + 1;
      }

      const { user_id: _omit, ...appOut } = app;
      return toolOk({ application: appOut, company_research: company, document_counts });
    }

    case "get_document": {
      const application_id = str(args.application_id);
      const type = str(args.type);
      if (!application_id || !type || !["resume", "cover_letter"].includes(type)) {
        return toolErr("application_id and type ('resume'|'cover_letter') are required");
      }
      const { data: doc, error } = await supabase
        .from("documents")
        .select("content_md, created_at")
        .eq("user_id", uid)
        .eq("application_id", application_id)
        .eq("type", type)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return toolErr(error.message);
      if (!doc) return toolErr(`No ${type === "resume" ? "resume" : "cover letter"} has been generated for this application yet`);
      return toolOk({ type, content_md: doc.content_md, created_at: doc.created_at });
    }

    case "add_application": {
      const company_name = str(args.company_name);
      const job_title = str(args.job_title);
      if (!company_name || !job_title) return toolErr("company_name and job_title are required");
      const status = str(args.status) ?? "new";
      if (!STATUSES.includes(status)) return toolErr(`Invalid status. Use one of: ${STATUSES.join(", ")}`);
      const { data, error } = await supabase
        .from("applications")
        .insert({
          user_id: uid,
          company_name,
          job_title,
          job_url: str(args.job_url),
          job_description: str(args.job_description),
          location: str(args.location),
          salary: str(args.salary),
          source: "mcp",
          status,
        })
        .select("id")
        .single();
      if (error) return toolErr(error.message);
      return toolOk({ id: data.id, company_name, job_title, status });
    }

    case "update_application": {
      const id = str(args.id);
      if (!id) return toolErr("id is required");
      const patch: Record<string, unknown> = {};
      if (args.status !== undefined) {
        const status = str(args.status);
        if (!status || !STATUSES.includes(status)) {
          return toolErr(`Invalid status. Use one of: ${STATUSES.join(", ")}`);
        }
        patch.status = status;
      }
      if (args.notes !== undefined) patch.notes = str(args.notes);
      if (args.date_applied !== undefined) {
        const d = str(args.date_applied);
        if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return toolErr("date_applied must be YYYY-MM-DD");
        patch.date_applied = d;
      }
      if (args.job_description !== undefined) patch.job_description = str(args.job_description);
      if (Object.keys(patch).length === 0) {
        return toolErr("Nothing to update - provide at least one of: status, notes, date_applied, job_description");
      }
      const { data, error } = await supabase
        .from("applications")
        .update(patch)
        .eq("user_id", uid)
        .eq("id", id)
        .select("id, company_name, job_title, status, notes, date_applied, updated_at")
        .maybeSingle();
      if (error) return toolErr(error.message);
      if (!data) return toolErr("Application not found");
      return toolOk(data);
    }

    case "get_profile": {
      const { data, error } = await supabase
        .from("profile")
        .select("full_name, location, master_resume_md, highlights_md, skills_md, extra_context_md")
        .eq("user_id", uid)
        .maybeSingle();
      if (error) return toolErr(error.message);
      if (!data) return toolErr("Profile not found - fill out your Profile in the app first");
      return toolOk(data);
    }

    case "get_stats": {
      const { data, error } = await supabase
        .from("applications")
        .select("status")
        .eq("user_id", uid);
      if (error) return toolErr(error.message);
      const by_status: Record<string, number> = {};
      for (const s of STATUSES) by_status[s] = 0;
      for (const a of data ?? []) by_status[a.status] = (by_status[a.status] ?? 0) + 1;
      return toolOk({ by_status, total: (data ?? []).length });
    }

    default:
      return toolErr(`Unknown tool: ${name}`);
  }
}

async function handleMessage(
  supabase: SupabaseClient,
  uid: string,
  msg: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> },
): Promise<unknown | null> {
  const { id, method } = msg;
  const params = msg.params ?? {};

  // Notifications (no response expected)
  if (typeof method === "string" && method.startsWith("notifications/")) return null;

  switch (method) {
    case "initialize": {
      const requested = (params as { protocolVersion?: string }).protocolVersion;
      return rpcResult(id, {
        protocolVersion: typeof requested === "string" && requested ? requested : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "jobtracker-mcp", version: "1.0.0" },
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call": {
      const name = (params as { name?: string }).name;
      const args = ((params as { arguments?: Record<string, unknown> }).arguments ?? {}) as Record<string, unknown>;
      if (!name) return rpcError(id, -32602, "tools/call requires params.name");
      // Rate limit the tool calls (the part that touches data). The protocol
      // handshake (initialize / tools/list) is deliberately not counted, since
      // clients re-run it on every reconnect. Fails OPEN on a check error.
      try {
        const { data: allowed, error: rlErr } = await supabase.rpc("check_rate_limit", {
          p_user_id: uid,
          p_bucket: "mcp",
          p_max: 300,
          p_window_seconds: 3600,
        });
        if (rlErr) {
          console.error(`mcp: rate limit check failed: ${rlErr.message}`);
        } else if (allowed === false) {
          return rpcResult(id, toolErr("You are going too fast. Try again in a minute."));
        }
      } catch (e) {
        console.error(`mcp: rate limit check threw: ${String((e as Error)?.message ?? e)}`);
      }
      try {
        return rpcResult(id, await callTool(supabase, uid, name, args));
      } catch (e) {
        return rpcResult(id, toolErr(String((e as Error)?.message ?? e)));
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method === "GET") {
    // No server-initiated SSE stream in this stateless implementation.
    return json(rpcError(null, -32000, "Method Not Allowed: this MCP server only supports POST"), 405);
  }
  if (req.method !== "POST") {
    return json(rpcError(null, -32000, "Method Not Allowed"), 405);
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Authenticate via JobTracker API token
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return json(rpcError(null, -32001, "Unauthorized: missing Authorization: Bearer <api token> header (find your token in Settings)"), 401);
    }
    const { data: owner } = await supabase
      .from("profile")
      .select("user_id")
      .eq("api_token", token)
      .maybeSingle();
    if (!owner) {
      return json(rpcError(null, -32001, "Unauthorized: unknown API token (check Settings in the JobTracker app)"), 401);
    }
    const uid: string = owner.user_id;

    let body: unknown;
    try {
      body = await req.json();
    } catch (_e) {
      return json(rpcError(null, -32700, "Parse error: body must be JSON"), 400);
    }

    // Batch support (2025-03-26 era clients); single object is the common case.
    if (Array.isArray(body)) {
      const responses = [];
      for (const m of body) {
        const r = await handleMessage(supabase, uid, m ?? {});
        if (r !== null) responses.push(r);
      }
      if (responses.length === 0) return new Response(null, { status: 202, headers: cors });
      return json(responses);
    }

    const msg = (body ?? {}) as { id?: unknown; method?: string };
    const resp = await handleMessage(supabase, uid, msg);
    if (resp === null) return new Response(null, { status: 202, headers: cors });
    return json(resp);
  } catch (e) {
    return json(rpcError(null, -32603, `Internal error: ${String((e as Error)?.message ?? e)}`), 500);
  }
});
