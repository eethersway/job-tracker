/**
 * import-url: fetch a job posting URL server-side and extract its fields.
 *
 * Returns the parsed fields for the client to PREFILL a review form; it never
 * inserts an application itself. Costs nothing (no AI): JSON-LD first, then
 * site-specific handling, then meta/heuristic fallbacks. When extraction is
 * incomplete the response says so and the user fills the gaps by hand.
 *
 * SECURITY: this endpoint fetches a user-supplied URL and echoes page text back,
 * so it is a potential SSRF read primitive. Defenses:
 *   - authenticated callers only (anon key alone is not enough)
 *   - per-user rate limits on outbound fetching
 *   - hostname normalized (lowercase, trailing dots stripped) before every check
 *   - DNS resolved and every resulting IP checked against private/loopback/
 *     link-local/CGNAT/ULA ranges; unresolvable hosts are rejected
 *   - redirects followed manually (max 3), re-validating every hop
 *   - ports restricted to 80/443, credentials in the URL rejected
 *   - 8s timeout and a response size cap on every fetch
 *   - one generic failure message: no upstream status codes or exception text
 */

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

// Rate limiting. Fails OPEN: an infrastructure hiccup should not become a wall
// of 429s. Skipped for service_role callers, which have no user id.
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
      console.error(`import-url: rate limit check '${bucket}' failed: ${error.message}`);
      return true;
    }
    return data !== false;
  } catch (e) {
    console.error(`import-url: rate limit check '${bucket}' threw: ${String((e as Error)?.message ?? e)}`);
    return true;
  }
}

const TOO_FAST = "You are going too fast. Try again in a minute.";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
const MAX_BYTES = 3_000_000;
const MAX_DESC = 15000;
const FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

// Single generic message for every fetch/target failure: revealing upstream
// status codes or exception text would turn this endpoint into a port scanner.
const GENERIC_FETCH_ERROR = "Could not read that page. Paste the job description manually instead.";

/* ------------------------------- IP checks -------------------------------- */

function parseIpv4(s: string): number[] | null {
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1, 5).map(Number);
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return parts;
}

function isBlockedIpv4(p: number[]): boolean {
  const [a, b] = p;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0) return true; // IETF protocol assignments / test-net
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function parseIpv6(input: string): number[] | null {
  let s = input.trim().toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  if (!s.includes(":")) return null;

  // Embedded IPv4 tail, e.g. ::ffff:127.0.0.1
  const m = s.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (m) {
    const v4 = parseIpv4(m[2]);
    if (!v4) return null;
    s = m[1] + (((v4[0] << 8) | v4[1]).toString(16)) + ":" + (((v4[2] << 8) | v4[3]).toString(16));
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let hextets: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    hextets = [...head, ...new Array(fill).fill("0"), ...tail];
  } else {
    hextets = head;
  }
  if (hextets.length !== 8) return null;

  const bytes: number[] = [];
  for (const h of hextets) {
    if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
    const v = parseInt(h, 16);
    bytes.push((v >> 8) & 0xff, v & 0xff);
  }
  return bytes;
}

function isBlockedIpv6(b: number[]): boolean {
  if (b.every((x) => x === 0)) return true; // ::
  if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return true; // ::1
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 link local
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d)
  const first10Zero = b.slice(0, 10).every((x) => x === 0);
  if (first10Zero && ((b[10] === 0xff && b[11] === 0xff) || (b[10] === 0 && b[11] === 0))) {
    return isBlockedIpv4([b[12], b[13], b[14], b[15]]);
  }
  return false;
}

function isBlockedIp(addr: string): boolean {
  const v4 = parseIpv4(addr);
  if (v4) return isBlockedIpv4(v4);
  const v6 = parseIpv6(addr);
  if (v6) return isBlockedIpv6(v6);
  return true; // unparseable: fail closed
}

/* ----------------------------- URL validation ----------------------------- */

const BAD_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

/** Full validation of a user-supplied (or redirect-supplied) target. */
async function validateTarget(
  raw: string | URL,
): Promise<{ url: URL } | { error: string }> {
  let url: URL;
  try {
    url = raw instanceof URL ? new URL(raw.toString()) : new URL(String(raw).trim());
  } catch {
    return { error: "That does not look like a valid URL." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: "Only http and https links are supported." };
  }
  // Credentials in the URL can be used to authenticate against internal services.
  if (url.username || url.password) return { error: GENERIC_FETCH_ERROR };

  // Only the standard web ports; everything else is an internal-service probe.
  const port = url.port;
  if (port !== "" && port !== "80" && port !== "443") return { error: GENERIC_FETCH_ERROR };
  if (port === "80" && url.protocol !== "http:") return { error: GENERIC_FETCH_ERROR };
  if (port === "443" && url.protocol !== "https:") return { error: GENERIC_FETCH_ERROR };

  // Normalize: lowercase and strip trailing dots ("localhost." == "localhost").
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (!host) return { error: GENERIC_FETCH_ERROR };
  url.hostname = host; // fetch the normalized name, not the raw one

  if (host === "localhost" || host === "metadata.google.internal") {
    return { error: GENERIC_FETCH_ERROR };
  }
  if (BAD_SUFFIXES.some((s) => host.endsWith(s))) return { error: GENERIC_FETCH_ERROR };

  // IP literals: check directly, no DNS involved.
  const bracketed = host.startsWith("[") && host.endsWith("]");
  const literalV4 = parseIpv4(host);
  if (literalV4) {
    return isBlockedIpv4(literalV4) ? { error: GENERIC_FETCH_ERROR } : { url };
  }
  if (bracketed || host.includes(":")) {
    const v6 = parseIpv6(host);
    if (!v6 || isBlockedIpv6(v6)) return { error: GENERIC_FETCH_ERROR };
    return { url };
  }

  // Resolve DNS and validate every answer: defeats wildcard-DNS tricks such as
  // 127.0.0.1.nip.io that look public but point at internal addresses.
  const addrs: string[] = [];
  let dnsErr: string | null = null;
  try {
    addrs.push(...await Deno.resolveDns(host, "A"));
  } catch (e) {
    dnsErr = `${(e as Error)?.name}: ${String((e as Error)?.message).slice(0, 120)}`;
  }
  try {
    addrs.push(...await Deno.resolveDns(host, "AAAA"));
  } catch (_e) { /* AAAA is optional when A resolved */ }

  if (addrs.length === 0) {
    // Either the host genuinely does not resolve, or Deno.resolveDns is
    // unavailable/denied in this runtime - in which case EVERY import fails and
    // this log is the only signal. Fail closed either way.
    console.error(`import-url: no DNS answers for ${host}${dnsErr ? ` (${dnsErr})` : ""}`);
    return { error: GENERIC_FETCH_ERROR };
  }
  if (addrs.some((a) => isBlockedIp(a))) return { error: GENERIC_FETCH_ERROR };

  return { url };
}

/* --------------------------------- fetch ---------------------------------- */

async function readCapped(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }
  try { await reader.cancel(); } catch { /* ignore */ }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c.subarray(0, Math.min(c.length, total - off)), off);
    off += c.length;
  }
  return new TextDecoder("utf-8").decode(buf);
}

/**
 * Fetch a page, following at most MAX_REDIRECTS hops manually and re-validating
 * every hop. Returns null on any failure (callers must not learn why).
 * `trusted` skips validation for the FIRST url only, for hardcoded hosts we
 * construct ourselves; redirects from it are still fully validated.
 */
async function fetchPage(start: URL, opts: { trusted?: boolean } = {}): Promise<string | null> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (hop > 0 || !opts.trusted) {
      const checked = await validateTarget(current);
      if ("error" in checked) return null;
      current = checked.url;
    }

    let resp: Response;
    try {
      resp = await fetch(current.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
    } catch (_e) {
      return null; // timeouts, DNS failures, connection refused: all identical to the caller
    }

    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location");
      try { await resp.body?.cancel(); } catch { /* ignore */ }
      if (!loc || hop === MAX_REDIRECTS) return null;
      try {
        current = new URL(loc, current);
      } catch {
        return null;
      }
      continue;
    }

    if (!resp.ok || !resp.body) {
      try { await resp.body?.cancel(); } catch { /* ignore */ }
      return null;
    }

    const len = Number(resp.headers.get("content-length") ?? "");
    if (Number.isFinite(len) && len > MAX_BYTES) {
      try { await resp.body.cancel(); } catch { /* ignore */ }
      return null;
    }

    return await readCapped(resp.body);
  }
  return null;
}

/* -------------------------------- parsing --------------------------------- */

const clean = (s: unknown): string =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";

const decodeEntities = (s: string): string =>
  s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/gi, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&[a-z]+;/gi, " ");

/** HTML fragment -> readable plain text with bullets and paragraph breaks. */
function htmlToText(html: string): string {
  if (typeof html !== "string") return "";
  const withBreaks = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(withBreaks)
    .split("\n")
    .map((l) => l.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface Fields {
  company_name: string;
  job_title: string;
  location: string;
  salary: string;
  job_description: string;
}

const empty = (): Fields => ({
  company_name: "",
  job_title: "",
  location: "",
  salary: "",
  job_description: "",
});

function mergeInto(target: Fields, src: Partial<Fields>) {
  for (const k of Object.keys(target) as (keyof Fields)[]) {
    if (!target[k] && src[k]) target[k] = src[k] as string;
  }
}

/** Pull JobPosting data out of any JSON-LD blocks on the page. */
function fromJsonLd(html: string): Partial<Fields> {
  const out: Partial<Fields> = {};
  const blocks = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const m of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const nodes: Record<string, unknown>[] = [];
    const push = (n: unknown) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(push);
      const rec = n as Record<string, unknown>;
      nodes.push(rec);
      if (rec["@graph"]) push(rec["@graph"]);
    };
    push(parsed);

    for (const node of nodes) {
      const type = node["@type"];
      const isJob = Array.isArray(type)
        ? (type as unknown[]).includes("JobPosting")
        : type === "JobPosting";
      if (!isJob) continue;

      if (node.title) out.job_title = clean(node.title);

      const org = node.hiringOrganization as Record<string, unknown> | string | undefined;
      if (typeof org === "string") out.company_name = clean(org);
      else if (org && typeof org === "object" && org.name) out.company_name = clean(org.name);

      const locNode = Array.isArray(node.jobLocation) ? node.jobLocation[0] : node.jobLocation;
      if (typeof locNode === "string") out.location = clean(locNode);
      else if (locNode && typeof locNode === "object") {
        const l = locNode as Record<string, unknown>;
        const addr = (l.address ?? l) as Record<string, unknown>;
        const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
          .map((p) => clean(typeof p === "object" && p ? (p as Record<string, unknown>).name : p))
          .filter(Boolean);
        if (parts.length) out.location = parts.join(", ");
      }
      if (!out.location && node.jobLocationType === "TELECOMMUTE") out.location = "Remote";

      if (node.description) out.job_description = htmlToText(String(node.description));

      const sal = node.baseSalary as Record<string, unknown> | undefined;
      if (sal && typeof sal === "object") {
        const currency = clean(sal.currency);
        const v = sal.value as Record<string, unknown> | undefined;
        if (v && typeof v === "object") {
          const unit = clean(v.unitText).toLowerCase();
          const fmt = (n: unknown) => {
            const num = Number(n);
            return Number.isFinite(num) ? num.toLocaleString("en-US") : clean(n);
          };
          let range = "";
          if (v.minValue != null && v.maxValue != null) range = `${fmt(v.minValue)}-${fmt(v.maxValue)}`;
          else if (v.value != null) range = fmt(v.value);
          if (range) out.salary = [currency, range, unit ? `/ ${unit}` : ""].filter(Boolean).join(" ").trim();
        }
      }
      if (out.job_title || out.company_name) return out;
    }
  }
  return out;
}

function metaOf(html: string, prop: string): string {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`,
    "i",
  );
  const m = html.match(re) ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, "i"));
  return m ? decodeEntities(clean(m[1])) : "";
}

/** LinkedIn: use the public guest posting endpoint keyed by job id. */
function linkedInJobId(url: URL): string | null {
  const q = url.searchParams.get("currentJobId");
  if (q && /^\d+$/.test(q)) return q;
  const m = url.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/);
  if (m) return m[1];
  const trailing = url.pathname.match(/(\d{6,})\/?$/);
  return trailing ? trailing[1] : null;
}

function fromLinkedInGuest(html: string): Partial<Fields> {
  const out: Partial<Fields> = {};
  const title = html.match(/<h2[^>]*top-card-layout__title[^>]*>([\s\S]*?)<\/h2>/i) ??
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (title) out.job_title = decodeEntities(clean(title[1].replace(/<[^>]+>/g, " ")));
  const company = html.match(/topcard__org-name-link[^>]*>([\s\S]*?)<\/a>/i) ??
    html.match(/topcard__flavor[^>]*>([\s\S]*?)<\/(?:a|span)>/i);
  if (company) out.company_name = decodeEntities(clean(company[1].replace(/<[^>]+>/g, " ")));
  const loc = html.match(/topcard__flavor--bullet[^>]*>([\s\S]*?)<\/span>/i);
  if (loc) out.location = decodeEntities(clean(loc[1].replace(/<[^>]+>/g, " ")));
  const desc = html.match(/<div[^>]*(?:show-more-less-html__markup|description__text)[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) ??
    html.match(/<section[^>]*description[^>]*>([\s\S]*?)<\/section>/i);
  if (desc) out.job_description = htmlToText(desc[1]);
  return out;
}

/** Last resort: strip the whole document and keep the biggest text region. */
function fromGeneric(html: string): Partial<Fields> {
  const out: Partial<Fields> = {};
  const ogTitle = metaOf(html, "og:title");
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  out.job_title = (h1 ? decodeEntities(clean(h1[1].replace(/<[^>]+>/g, " "))) : "") || ogTitle;
  out.company_name = metaOf(html, "og:site_name");
  const main = html.match(/<main[\s\S]*?<\/main>/i) ??
    html.match(/<article[\s\S]*?<\/article>/i) ??
    html.match(/<body[\s\S]*?<\/body>/i);
  const text = main ? htmlToText(main[0]) : "";
  out.job_description = text.length > 200 ? text : metaOf(html, "og:description") || metaOf(html, "description");
  return out;
}

/** Company name of last resort: the registrable part of the hostname. */
function companyFromHost(url: URL): string {
  const host = url.hostname.replace(/^www\./, "");
  const parts = host.split(".");
  let base = parts.length > 2 ? parts[parts.length - 2] : parts[0];
  if (["greenhouse", "lever", "ashbyhq", "myworkdayjobs", "workday", "jobs", "careers", "boards"].includes(base)) {
    base = parts[0] === "www" ? parts[1] : parts[0];
  }
  if (["jobs", "careers", "boards", "apply", "job"].includes(base) && parts.length > 2) base = parts[1];
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "";
}

/* -------------------------------- handler --------------------------------- */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  try {
    // An anon-key JWT must not be able to drive server-side fetches.
    const who = caller(req);
    const isUser = !!who.sub && who.role !== "anon";
    if (!isUser && who.role !== "service_role") {
      return json({ ok: false, error: "Sign in required" }, 403);
    }

    // Rate limit outbound fetching per user (service_role has no sub to bill).
    if (who.sub) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      if (!await underLimit(supabase, who.sub, "import_burst", 10, 60)) {
        return json({ ok: false, error: TOO_FAST }, 429);
      }
      if (!await underLimit(supabase, who.sub, "import", 60, 3600)) {
        return json({ ok: false, error: TOO_FAST }, 429);
      }
    }

    const body = await req.json();
    const check = await validateTarget(String(body?.url ?? ""));
    if ("error" in check) return json({ ok: false, error: check.error }, 400);
    const url = check.url;

    const fields = empty();
    let note = "";

    // Path-specific fetch: LinkedIn's logged-in page is JS-rendered, so use the
    // public guest endpoint instead.
    const host = url.hostname.toLowerCase();
    const isLinkedIn = host === "linkedin.com" || host.endsWith(".linkedin.com");
    let html: string | null = null;

    if (isLinkedIn) {
      const jobId = linkedInJobId(url);
      if (!jobId) {
        return json({
          ok: false,
          error:
            "That LinkedIn link does not contain a job id. Open the posting itself (the URL should include /jobs/view/... or currentJobId=...) and copy that link.",
        }, 422);
      }
      // Hardcoded host we construct ourselves, so the first hop is trusted;
      // any redirect off it is still fully validated.
      const guest = new URL(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`);
      html = await fetchPage(guest, { trusted: true });
      if (html) {
        mergeInto(fields, fromLinkedInGuest(html));
        mergeInto(fields, fromJsonLd(html));
      }
      if (!fields.job_description) {
        const alt = await fetchPage(new URL(`https://www.linkedin.com/jobs/view/${jobId}/`), { trusted: true });
        if (alt) {
          mergeInto(fields, fromJsonLd(alt));
          mergeInto(fields, fromLinkedInGuest(alt));
          if (!html) html = alt;
        }
      }
    } else {
      html = await fetchPage(url);
      if (html) {
        mergeInto(fields, fromJsonLd(html));
        mergeInto(fields, fromGeneric(html));
      }
    }

    if (!html) {
      return json({ ok: false, blocked: true, error: GENERIC_FETCH_ERROR }, 422);
    }

    if (!fields.company_name) fields.company_name = companyFromHost(url);
    if (fields.job_description.length > MAX_DESC) {
      fields.job_description = fields.job_description.slice(0, MAX_DESC) + "\n…[truncated]";
    }

    const missing: string[] = [];
    if (!fields.job_title) missing.push("job title");
    if (!fields.company_name) missing.push("company");
    if (fields.job_description.length < 200) missing.push("description");
    if (missing.length) {
      note = `Could not read the ${missing.join(" and ")} from that page. Fill in what is missing before saving.`;
    }

    return json({
      ok: true,
      partial: missing.length > 0,
      note,
      fields: { ...fields, job_url: url.toString() },
    });
  } catch (e) {
    console.error("import-url failed:", String((e as Error)?.message ?? e));
    return json({ ok: false, error: GENERIC_FETCH_ERROR }, 500);
  }
});
