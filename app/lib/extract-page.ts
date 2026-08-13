/**
 * Shared job-posting extractor + bookmarklet builder.
 *
 * EXTRACTOR_SOURCE is a *string* on purpose: the bookmarklet injects it into
 * the job page's own context, so it can never be imported as a function. The
 * logic is a direct port of the extension's battle-tested extract.js
 * (JSON-LD -> site selectors -> heading-anchored pane with "…more" expansion
 * and tail-junk trimming -> generic fallback, plus URL canonicalization).
 *
 * Template literals from the original were rewritten as string concatenation
 * so the whole thing can live inside a String.raw template here (String.raw
 * keeps regex backslashes intact; a normal template literal would silently
 * turn \s into s and break every regex).
 */

/** Self-contained IIFE that returns { company, title, location, salary, description, url }. */
export const EXTRACTOR_SOURCE: string = String.raw`(() => {
const MAX_DESC = 15000;
const clean = (s) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
const cleanBlock = (s) => {
if (typeof s !== "string") return "";
return s
.replace(/\r\n?/g, "\n")
.split("\n")
.map((line) => line.replace(/[^\S\n]+/g, " ").trim())
.join("\n")
.replace(/\n{3,}/g, "\n\n")
.trim();
};
const htmlToText = (html) => {
if (typeof html !== "string") return "";
try {
const doc = new DOMParser().parseFromString(
html
.replace(/<br\s*\/?>/gi, "\n")
.replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|section)>/gi, "\n")
.replace(/<li[^>]*>/gi, "• "),
"text/html"
);
return cleanBlock(doc.body ? doc.body.textContent || "" : "");
} catch (e) {
return cleanBlock(html.replace(/<[^>]+>/g, " "));
}
};
const textOf = (selector, root) => {
try {
const el = (root || document).querySelector(selector);
return el ? clean(el.textContent) : "";
} catch (e) {
return "";
}
};
const blockTextOf = (selector, root) => {
try {
const el = (root || document).querySelector(selector);
return el ? cleanBlock(el.innerText || el.textContent || "") : "";
} catch (e) {
return "";
}
};
const metaContent = (nameOrProp) => {
try {
const el = document.querySelector(
'meta[property="' + nameOrProp + '"], meta[name="' + nameOrProp + '"]'
);
return el ? clean(el.getAttribute("content")) : "";
} catch (e) {
return "";
}
};
const result = { company: "", title: "", location: "", salary: "", description: "" };
const merge = (data) => {
for (const key of Object.keys(result)) {
if (!result[key] && data[key]) result[key] = data[key];
}
};
const fromJsonLd = () => {
const out = {};
try {
const scripts = document.querySelectorAll('script[type="application/ld+json"]');
for (const script of scripts) {
let parsed;
try {
parsed = JSON.parse(script.textContent);
} catch (e) {
continue;
}
const candidates = [];
const push = (node) => {
if (!node || typeof node !== "object") return;
if (Array.isArray(node)) return node.forEach(push);
candidates.push(node);
if (node["@graph"]) push(node["@graph"]);
};
push(parsed);
for (const node of candidates) {
const type = node["@type"];
const isJob = Array.isArray(type)
? type.includes("JobPosting")
: type === "JobPosting";
if (!isJob) continue;
if (node.title) out.title = clean(String(node.title));
const org = node.hiringOrganization;
if (org) {
if (typeof org === "string") out.company = clean(org);
else if (org.name) out.company = clean(String(org.name));
}
const locNode = Array.isArray(node.jobLocation)
? node.jobLocation[0]
: node.jobLocation;
if (locNode) {
if (typeof locNode === "string") {
out.location = clean(locNode);
} else {
const addr = locNode.address || locNode;
if (typeof addr === "string") out.location = clean(addr);
else if (addr && typeof addr === "object") {
const parts = [
addr.addressLocality,
addr.addressRegion,
addr.addressCountry && (addr.addressCountry.name || addr.addressCountry),
]
.map((p) => clean(typeof p === "string" ? p : ""))
.filter(Boolean);
out.location = parts.join(", ");
}
}
}
if (!out.location && node.jobLocationType === "TELECOMMUTE") {
out.location = "Remote";
}
if (node.description) out.description = htmlToText(String(node.description));
const salary = node.baseSalary;
if (salary) {
if (typeof salary === "string" || typeof salary === "number") {
out.salary = clean(String(salary));
} else if (typeof salary === "object") {
const currency = clean(String(salary.currency || ""));
const value = salary.value;
if (value && typeof value === "object") {
const unit = clean(String(value.unitText || "")).toLowerCase();
const fmt = (n) => {
const num = Number(n);
return Number.isFinite(num) ? num.toLocaleString("en-US") : clean(String(n));
};
let range = "";
if (value.minValue != null && value.maxValue != null) {
range = fmt(value.minValue) + "–" + fmt(value.maxValue);
} else if (value.value != null) {
range = fmt(value.value);
} else if (value.minValue != null) {
range = "from " + fmt(value.minValue);
} else if (value.maxValue != null) {
range = "up to " + fmt(value.maxValue);
}
if (range) {
out.salary = [currency, range, unit ? "/ " + unit : ""]
.filter(Boolean)
.join(" ")
.trim();
}
} else if (value != null) {
out.salary = clean(currency + " " + value);
}
}
}
if (out.title || out.company) return out;
}
}
} catch (e) {}
return out;
};
const fromSiteSelectors = () => {
const host = location.hostname;
const out = {};
try {
if (host.includes("linkedin.com")) {
out.title =
textOf(".job-details-jobs-unified-top-card__job-title") ||
textOf(".jobs-unified-top-card__job-title") ||
textOf("h1.top-card-layout__title") ||
textOf("h1");
out.company =
textOf(".job-details-jobs-unified-top-card__company-name a") ||
textOf(".job-details-jobs-unified-top-card__company-name") ||
textOf(".jobs-unified-top-card__company-name a") ||
textOf("a.topcard__org-name-link");
out.location =
textOf(".job-details-jobs-unified-top-card__primary-description-container .tvm__text") ||
textOf(".jobs-unified-top-card__bullet") ||
textOf(".topcard__flavor--bullet");
out.description =
blockTextOf("#job-details") ||
blockTextOf(".jobs-description__content") ||
blockTextOf(".description__text");
} else if (host.includes("greenhouse.io")) {
out.title = textOf(".app-title") || textOf("h1.section-header") || textOf("h1");
out.company =
textOf(".company-name") ||
clean((metaContent("og:site_name") || "").replace(/careers?$/i, ""));
out.location = textOf(".location") || textOf(".job__location");
out.description = blockTextOf("#content") || blockTextOf(".job__description");
} else if (host.includes("lever.co")) {
out.title = textOf(".posting-headline h2") || textOf("h2");
out.location = textOf(".posting-categories .location") || textOf(".sort-by-time.posting-category");
out.description = blockTextOf(".posting-page .section-wrapper") || blockTextOf('[data-qa="job-description"]');
const m = location.pathname.match(/^\/([^/]+)\//);
if (m) out.company = clean(m[1].replace(/[-_]/g, " "));
} else if (host.includes("ashbyhq.com")) {
out.title = textOf("h1");
out.description = blockTextOf('[class*="description" i]') || blockTextOf("main");
const m = location.pathname.match(/^\/([^/]+)\//);
if (m) out.company = clean(decodeURIComponent(m[1]).replace(/[-_]/g, " "));
} else if (host.includes("myworkdayjobs.com") || host.includes("workday")) {
out.title = textOf('h2[data-automation-id="jobPostingHeader"]') || textOf("h1, h2");
out.location = textOf('[data-automation-id="locations"] dd') || textOf('[data-automation-id="locations"]');
out.description = blockTextOf('[data-automation-id="jobPostingDescription"]');
const m = location.hostname.match(/^([^.]+)\./);
if (m && m[1] !== "www") out.company = clean(m[1].replace(/[-_]/g, " "));
} else if (host.includes("indeed.com")) {
out.title =
textOf("h1.jobsearch-JobInfoHeader-title") ||
textOf('[data-testid="jobsearch-JobInfoHeader-title"]') ||
textOf("h1");
out.company =
textOf('[data-testid="inlineHeader-companyName"] a') ||
textOf('[data-testid="inlineHeader-companyName"]') ||
textOf('[data-company-name="true"]');
out.location =
textOf('[data-testid="inlineHeader-companyLocation"]') ||
textOf('[data-testid="job-location"]');
out.salary = textOf("#salaryInfoAndJobType .attribute_snippet") || textOf("#salaryInfoAndJobType");
out.description = blockTextOf("#jobDescriptionText");
}
} catch (e) {}
return out;
};
const ANCHOR_HEADINGS = [
"about the job",
"about the role",
"about this role",
"job description",
"description",
"overview",
"the role",
];
const TAIL_JUNK = [
"job search faster with premium",
"reactivate premium",
"are these results helpful",
"see jobs where you're a top applicant",
"see jobs where you’re a top applicant",
"get personalized tips to stand out",
"referrals increase your chances",
"set alert for similar jobs",
];
const findAnchorHeading = () => {
try {
const els = document.querySelectorAll("h1,h2,h3,h4,strong,b");
for (const el of els) {
if (el.childElementCount > 1) continue;
const t = clean(el.textContent).toLowerCase();
if (t && ANCHOR_HEADINGS.includes(t)) return el;
}
} catch (e) {}
return null;
};
const fromHeadingAnchor = () => {
const out = {};
try {
const h = findAnchorHeading();
if (!h) return out;
try {
let scope = h.parentElement;
for (let i = 0; i < 3 && scope && scope !== document.body; i++) scope = scope.parentElement;
const btns = (scope || document).querySelectorAll("button, [role='button']");
for (const b of btns) {
const t = clean(b.textContent).toLowerCase().replace(/^…\s*/, "").replace(/\s+/g, " ");
const label = (b.getAttribute("aria-label") || "").toLowerCase();
if (
t === "more" || t === "see more" || t === "show more" ||
label.includes("see more") || label.includes("show more")
) {
try { b.click(); } catch (e) {}
}
}
} catch (e) {}
let desc = "";
let sib = h.nextElementSibling;
while (sib) {
desc += (sib.innerText || sib.textContent || "") + "\n";
sib = sib.nextElementSibling;
}
let container = h.parentElement;
let hops = 0;
const headingText = clean(h.textContent);
while (clean(desc).length < 200 && container && container !== document.body && hops < 4) {
const t = container.innerText || "";
const idx = t.indexOf(headingText);
desc = idx >= 0 ? t.slice(idx + headingText.length) : t;
container = container.parentElement;
hops++;
}
desc = cleanBlock(desc);
const lower = desc.toLowerCase();
let cut = desc.length;
for (const junk of TAIL_JUNK) {
const i = lower.indexOf(junk);
if (i >= 0 && i < cut) cut = i;
}
desc = desc.slice(0, cut).trim();
desc = desc
.split("\n")
.filter((line) => !/^(…\s*)?(see\s|show\s)?(more|less)$/i.test(line.trim()))
.join("\n")
.replace(/\n?…\s*more\s*$/i, "")
.trim();
if (desc.length >= 120) out.description = desc;
let pane = h.parentElement;
while (pane && pane !== document.body) {
let hasApply = false;
const btns = pane.querySelectorAll("button, a[role='button'], a");
for (const b of btns) {
const t = clean(b.textContent).toLowerCase();
if (t === "apply" || t === "easy apply" || t.startsWith("apply ")) {
hasApply = true;
break;
}
}
if (hasApply) break;
pane = pane.parentElement;
}
if (pane && pane !== document.body) {
const dedupe = (s) => {
const half = Math.floor(s.length / 2);
if (s.length > 8 && s.length % 2 === 0 && s.slice(0, half) === s.slice(half)) {
return s.slice(0, half);
}
return s;
};
let titleEl = null;
try {
titleEl = Array.from(pane.querySelectorAll('a[href*="/jobs/view/"]')).find(
(a) => clean(a.textContent).length > 3
) || null;
} catch (e) {}
if (!titleEl) {
const heads = Array.from(pane.querySelectorAll("h1,h2,h3")).filter((el) => {
const t = clean(el.textContent).toLowerCase();
return t && t.length < 120 && !ANCHOR_HEADINGS.includes(t);
});
titleEl =
heads.find((el) => h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) ||
heads[0] ||
null;
}
if (titleEl) out.title = dedupe(clean(titleEl.textContent));
const coLink = pane.querySelector('a[href*="/company/"]');
if (coLink) out.company = clean(coLink.textContent);
const paneLines = (pane.innerText || "").split("\n");
for (const line of paneLines) {
if (!line.includes("·")) continue;
if (!/(ago|applicant|clicked apply)/i.test(line)) continue;
const first = clean(line.split("·")[0]);
if (first && first.length <= 60 && !/(ago|applicant|apply)/i.test(first)) {
out.location = first;
break;
}
}
}
} catch (e) {}
return out;
};
const fromGeneric = () => {
const out = {};
try {
out.title = textOf("h1") || metaContent("og:title") || clean(document.title);
out.company = metaContent("og:site_name");
const mainEl =
document.querySelector("main") ||
document.querySelector("article") ||
document.querySelector('[role="main"]') ||
document.body;
const mainText = mainEl ? cleanBlock(mainEl.innerText || "") : "";
out.description = mainText || metaContent("description") || metaContent("og:description");
} catch (e) {}
return out;
};
merge(fromJsonLd());
merge(fromSiteSelectors());
merge(fromHeadingAnchor());
if (!location.hostname.includes("linkedin.com")) {
merge(fromGeneric());
} else {
const g = fromGeneric();
delete g.description;
merge(g);
}
if (result.description.length > MAX_DESC) {
result.description = result.description.slice(0, MAX_DESC) + "\n…[truncated]";
}
let url = location.href;
try {
const u = new URL(url);
if (u.hostname.includes("linkedin.com")) {
const jobId = u.searchParams.get("currentJobId");
if (jobId && /^\d+$/.test(jobId)) {
url = "https://www.linkedin.com/jobs/view/" + jobId + "/";
} else {
const m = u.pathname.match(/\/jobs\/view\/(\d+)/);
if (m) url = "https://www.linkedin.com/jobs/view/" + m[1] + "/";
}
} else {
const junk = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gh_src", "lever-source", "src", "trk", "refId", "trackingId"];
junk.forEach((p) => u.searchParams.delete(p));
url = u.toString();
}
} catch (e) {}
result.url = url;
return result;
})();`;

/** Message types exchanged between the bookmarklet and the /capture popup. */
export const CAPTURE_READY = "sa_capture_ready";
export const CAPTURE_PAYLOAD = "sa_capture_payload";

/**
 * Build the full `javascript:` bookmarklet for the given app origin.
 *
 * Order matters: window.open runs FIRST, synchronously, before any DOM work.
 * Browsers only permit popups while user activation is live, and the
 * extractor is expensive (it even clicks LinkedIn's "see more" expanders), so
 * extracting first can silently lose activation and the popup never appears.
 *
 * After the popup exists we extract (in try/catch, falling back to an empty
 * payload so the popup still shows its review form), then hand the payload
 * over with postMessage. No fetch happens from the job page, so the page's
 * CSP can never block the handover. The handshake retries for ~15s.
 *
 * The single alert() is deliberate and limited to the popup-blocked case:
 * that is a dead end the user must act on, and failing silently is worse.
 */
export function buildBookmarklet(origin: string): string {
  const wrapper = `(function(){
var O=${JSON.stringify(origin)};
console.log("[StrongerApplicant] bookmarklet running on",location.href);
var W=null;
try{W=window.open(O+"/capture","sa_capture","width=560,height=720");}catch(e){console.warn("[StrongerApplicant] window.open threw",e);}
console.log("[StrongerApplicant] popup opened:",!!W);
if(!W){
console.warn("[StrongerApplicant] popup blocked by the browser");
try{alert("StrongerApplicant: your browser blocked the capture window. Allow popups for this site and click the bookmark again.");}catch(e){}
return;
}
try{
var P={company:"",title:"",location:"",salary:"",description:"",url:location.href};
try{
var R=${EXTRACTOR_SOURCE}
if(R&&typeof R==="object")P=R;
}catch(e){console.warn("[StrongerApplicant] extraction failed, sending empty payload",e);}
var L=function(v){return typeof v==="string"?v.length:0;};
console.log("[StrongerApplicant] extracted field lengths",{company:L(P.company),title:L(P.title),location:L(P.location),salary:L(P.salary),description:L(P.description),url:L(P.url)});
var done=false;
var sent=0;
var send=function(){
try{
W.postMessage({type:${JSON.stringify(CAPTURE_PAYLOAD)},payload:P},O);
sent++;
console.log("[StrongerApplicant] payload posted to popup (attempt "+sent+")");
}catch(e){console.warn("[StrongerApplicant] handover failed",e);}
};
var onMsg=function(e){
if(e.origin!==O)return;
var d=e.data;
if(!d||d.type!==${JSON.stringify(CAPTURE_READY)})return;
console.log("[StrongerApplicant] popup reported ready");
done=true;
try{window.removeEventListener("message",onMsg);}catch(e){}
send();
};
window.addEventListener("message",onMsg);
var n=0;
var t=setInterval(function(){
n++;
if(done||n>60){
clearInterval(t);
if(!done){
try{window.removeEventListener("message",onMsg);}catch(e){}
console.warn("[StrongerApplicant] the capture window did not respond after 15s");
}
return;
}
console.log("[StrongerApplicant] ready-handshake attempt "+n);
send();
},250);
}catch(e){console.warn("[StrongerApplicant] capture failed",e);}
})();`;

  // Drop per-line indentation (there are no multi-line string literals, so
  // this is safe) and percent-encode so the URL survives being pasted into
  // or dragged onto a bookmarks bar.
  const compact = wrapper.replace(/\n\s*/g, "\n");
  return `javascript:${encodeURIComponent(compact)}`;
}
