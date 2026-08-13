/**
 * JobTracker Capture — page extraction script.
 * Injected into the active tab via chrome.scripting.executeScript.
 * Returns a plain object: { company, title, location, salary, description, url }.
 *
 * Strategy (merged, best value wins in this priority order):
 *   1. JSON-LD JobPosting structured data
 *   2. Site-specific selectors (LinkedIn, Greenhouse, Lever, Ashby, Workday, Indeed)
 *   3. Generic fallbacks (og:title, h1, meta description, main content)
 */
(() => {
  const MAX_DESC = 15000;

  const clean = (s) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

  // Collapse whitespace but preserve paragraph breaks for descriptions.
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

  // Strip HTML markup to readable plain text (for JSON-LD descriptions).
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
        `meta[property="${nameOrProp}"], meta[name="${nameOrProp}"]`
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

  // ---------- 1. JSON-LD JobPosting ----------
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
        // JSON-LD can be a single object, an array, or use @graph.
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

          // jobLocation: object or array of Place → address
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
                  range = `${fmt(value.minValue)}–${fmt(value.maxValue)}`;
                } else if (value.value != null) {
                  range = fmt(value.value);
                } else if (value.minValue != null) {
                  range = `from ${fmt(value.minValue)}`;
                } else if (value.maxValue != null) {
                  range = `up to ${fmt(value.maxValue)}`;
                }
                if (range) {
                  out.salary = [currency, range, unit ? `/ ${unit}` : ""]
                    .filter(Boolean)
                    .join(" ")
                    .trim();
                }
              } else if (value != null) {
                out.salary = clean(`${currency} ${value}`);
              }
            }
          }
          if (out.title || out.company) return out; // good enough; stop scanning
        }
      }
    } catch (e) {
      /* ignore */
    }
    return out;
  };

  // ---------- 2. Site-specific selectors ----------
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
        // Lever URLs: jobs.lever.co/<company>/<id>
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
    } catch (e) {
      /* best effort */
    }
    return out;
  };

  // ---------- 2.5 Heading-anchored details pane ----------
  // Robust against obfuscated class names (LinkedIn logged-in UI, etc.):
  // anchor on a "About the job"-style heading, then derive the details pane.
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
    } catch (e) {
      /* ignore */
    }
    return null;
  };

  const fromHeadingAnchor = () => {
    const out = {};
    try {
      const h = findAnchorHeading();
      if (!h) return out;

      // Expand collapsed "…more" / "See more" sections near the description
      // before reading it (LinkedIn clamps long descriptions behind a button).
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
            try { b.click(); } catch (e) { /* ignore */ }
          }
        }
      } catch (e) { /* ignore */ }

      // Description = content after the heading (siblings first, widen if too short)
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
      // Trim trailing platform junk (premium upsells, footers, "similar jobs")
      const lower = desc.toLowerCase();
      let cut = desc.length;
      for (const junk of TAIL_JUNK) {
        const i = lower.indexOf(junk);
        if (i >= 0 && i < cut) cut = i;
      }
      desc = desc.slice(0, cut).trim();
      // Drop expander-button artifacts ("… more", "See more", "Show less")
      desc = desc
        .split("\n")
        .filter((line) => !/^(…\s*)?(see\s|show\s)?(more|less)$/i.test(line.trim()))
        .join("\n")
        .replace(/\n?…\s*more\s*$/i, "")
        .trim();
      if (desc.length >= 120) out.description = desc;

      // Details pane = nearest ancestor of the heading that also contains an Apply button
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
          // Sticky headers sometimes duplicate the text back-to-back
          const half = Math.floor(s.length / 2);
          if (s.length > 8 && s.length % 2 === 0 && s.slice(0, half) === s.slice(half)) {
            return s.slice(0, half);
          }
          return s;
        };
        // Title: prefer the pane's link to the job view (always present on
        // LinkedIn details panes), then real headings — never the anchor
        // heading itself ("About the job"), and prefer headings above it.
        let titleEl = null;
        try {
          titleEl = Array.from(pane.querySelectorAll('a[href*="/jobs/view/"]')).find(
            (a) => clean(a.textContent).length > 3
          ) || null;
        } catch (e) { /* ignore */ }
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

        // Location: a line like "United States · 1 week ago · 61 people clicked apply"
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
    } catch (e) {
      /* best effort */
    }
    return out;
  };

  // ---------- 3. Generic fallback ----------
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
    } catch (e) {
      /* ignore */
    }
    return out;
  };

  merge(fromJsonLd());
  merge(fromSiteSelectors());
  merge(fromHeadingAnchor());
  // On LinkedIn, never fall back to dumping the whole page (search results,
  // nav, and upsells pollute it). Elsewhere the generic fallback is still useful.
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

  // Clean the URL: LinkedIn currentJobId → canonical /jobs/view/ URL.
  let url = location.href;
  try {
    const u = new URL(url);
    if (u.hostname.includes("linkedin.com")) {
      const jobId = u.searchParams.get("currentJobId");
      if (jobId && /^\d+$/.test(jobId)) {
        url = `https://www.linkedin.com/jobs/view/${jobId}/`;
      } else {
        const m = u.pathname.match(/\/jobs\/view\/(\d+)/);
        if (m) url = `https://www.linkedin.com/jobs/view/${m[1]}/`;
      }
    } else {
      // Drop common tracking params on other sites.
      const junk = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gh_src", "lever-source", "src", "trk", "refId", "trackingId"];
      junk.forEach((p) => u.searchParams.delete(p));
      url = u.toString();
    }
  } catch (e) {
    /* keep original */
  }
  result.url = url;

  return result;
})();
