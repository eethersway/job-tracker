"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { CAPTURE_PAYLOAD, CAPTURE_READY } from "@/lib/extract-page";
import { safeHref } from "@/lib/safe-url";
import { STATUS_LABELS, STATUS_ORDER } from "@/lib/status";
import type { ApplicationStatus, CapturePayload } from "@/lib/types";

/**
 * Quick capture popup. The bookmarklet scrapes the job page in its own
 * context and hands the result here via postMessage, which keeps the whole
 * flow immune to the job site's CSP (we never fetch from that page).
 *
 * SECURITY: event.origin is the job board and is therefore meaningless as a
 * trust signal, so the payload is treated purely as untrusted DATA. Every
 * field is coerced to a string and rendered only into form input values.
 * Nothing from the payload is ever interpreted as HTML or markdown.
 */

const inputClass =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none transition focus:border-sky-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-400";

/** Max characters accepted from the payload for any single field. */
const MAX_FIELD = 20000;

/** Coerce an untrusted value to a bounded plain string. */
function asText(value: unknown, max = 400): string {
  if (typeof value !== "string") return "";
  return value.slice(0, Math.min(max, MAX_FIELD)).trim();
}

export default function CapturePage() {
  const { showToast } = useToast();

  const [received, setReceived] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedTitle, setSavedTitle] = useState("");

  const [companyName, setCompanyName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [salary, setSalary] = useState("");
  const [status, setStatus] = useState<ApplicationStatus>("new");
  const [urlWarning, setUrlWarning] = useState<string | null>(null);

  // Keep the latest "have we got data" flag readable inside the listener
  // without re-subscribing on every render.
  const receivedRef = useRef(false);
  receivedRef.current = received;

  const applyPayload = useCallback((payload: CapturePayload) => {
    setCompanyName((prev) => prev || asText(payload.company, 200));
    setJobTitle((prev) => prev || asText(payload.title, 300));
    // The payload comes from an arbitrary page, so a `javascript:` URL here
    // would become a click-to-XSS sink once stored and rendered as a link.
    const rawUrl = asText(payload.url, 2000);
    if (rawUrl && !safeHref(rawUrl)) {
      setUrlWarning(
        "The captured link was not a normal web address, so it was left out. You can paste the posting URL yourself."
      );
    } else {
      setJobUrl((prev) => prev || rawUrl);
    }
    setLocation((prev) => prev || asText(payload.location, 200));
    setSalary((prev) => prev || asText(payload.salary, 200));
    setDescription((prev) => prev || asText(payload.description, MAX_FIELD));
    setReceived(true);
  }, []);

  useEffect(() => {
    console.log("[StrongerApplicant] capture popup mounted, waiting for payload");

    function onMessage(event: MessageEvent) {
      // event.origin is the job board here, so it cannot be used as a trust
      // signal. Validate the SHAPE instead and treat contents as data only.
      const data = event.data as { type?: unknown; payload?: unknown } | null;
      if (!data || typeof data !== "object") return;
      if (data.type !== CAPTURE_PAYLOAD) return;
      const payload = data.payload;
      if (!payload || typeof payload !== "object") return;
      if (receivedRef.current) return; // first payload wins
      console.log("[StrongerApplicant] payload received from opener");
      applyPayload(payload as CapturePayload);
    }

    window.addEventListener("message", onMessage);

    // Tell the opener we are listening. This ping carries no data, so "*" is
    // acceptable; we still prefer the referrer's origin when it parses.
    let pingCount = 0;
    function pingOpener() {
      try {
        const opener = window.opener as Window | null;
        pingCount += 1;
        if (!opener) {
          console.warn(
            `[StrongerApplicant] ready ping ${pingCount}: no opener window`
          );
          return;
        }
        let target = "*";
        try {
          if (document.referrer) target = new URL(document.referrer).origin;
        } catch {
          target = "*";
        }
        console.log(
          `[StrongerApplicant] ready ping ${pingCount} to opener (target ${target})`
        );
        opener.postMessage({ type: CAPTURE_READY }, target);
        if (target !== "*") {
          // Belt and braces: some referrer policies hide the referrer.
          opener.postMessage({ type: CAPTURE_READY }, "*");
        }
      } catch (err) {
        // Opener gone or cross-origin restricted; the timeout copy covers it.
        console.warn("[StrongerApplicant] ready ping failed", err);
      }
    }

    pingOpener();
    // The bookmarklet also retries, but re-ping a few times in case this page
    // finished loading before the opener attached its listener.
    const pings = [200, 600, 1200, 2500].map((ms) =>
      setTimeout(pingOpener, ms)
    );
    const timeout = setTimeout(() => {
      if (!receivedRef.current) {
        console.warn(
          "[StrongerApplicant] no payload received after 20s, showing the fallback state"
        );
        setTimedOut(true);
      }
    }, 20000);

    return () => {
      window.removeEventListener("message", onMessage);
      pings.forEach(clearTimeout);
      clearTimeout(timeout);
    };
  }, [applyPayload]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim() || !jobTitle.trim()) {
      showToast("Company name and job title are required.", "error");
      return;
    }
    // Never write a non-http(s) URL to the database.
    const trimmedUrl = jobUrl.trim();
    if (trimmedUrl && !safeHref(trimmedUrl)) {
      setUrlWarning(
        "The job URL must start with http:// or https://. Clear it or fix it before saving."
      );
      return;
    }
    setUrlWarning(null);
    setSaving(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("applications")
        .insert({
          company_name: companyName.trim(),
          job_title: jobTitle.trim(),
          job_url: jobUrl.trim() || null,
          job_description: description.trim() || null,
          location: location.trim() || null,
          salary: salary.trim() || null,
          status,
          source: "manual",
        })
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      setSavedId((data as { id: string } | null)?.id ?? null);
      setSavedTitle(`${jobTitle.trim()} at ${companyName.trim()}`);
    } catch (err) {
      showToast(
        `Could not save: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
        "error"
      );
    } finally {
      setSaving(false);
    }
  }

  /** Open the saved application in the opener window when we still have one. */
  function viewInTracker() {
    if (!savedId) return;
    const href = `/application/${savedId}`;
    try {
      const opener = window.opener as Window | null;
      if (opener && !opener.closed) {
        opener.location.href = `${window.location.origin}${href}`;
        opener.focus();
        window.close();
        return;
      }
    } catch {
      // Cross-origin opener: fall through to a normal navigation.
    }
    window.location.href = href;
  }

  const heading = (
    <div className="mb-5 flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/20 text-sm font-bold text-sky-400">
        S
      </span>
      <span className="text-sm font-semibold tracking-tight text-slate-100">
        Stronger<span className="text-sky-400">Applicant</span>
      </span>
      <span className="ml-auto text-xs text-slate-500">Quick capture</span>
    </div>
  );

  // ---- Saved ----
  if (savedId !== null || savedTitle) {
    return (
      <div className="min-h-screen px-5 py-6">
        {heading}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-center">
          <p className="text-2xl">✅</p>
          <h1 className="mt-3 text-base font-semibold text-slate-100">
            Saved to your tracker
          </h1>
          <p className="mt-1.5 break-words text-sm text-slate-400">
            {savedTitle}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {savedId && (
              <button
                onClick={viewInTracker}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500"
              >
                View in tracker
              </button>
            )}
            <button
              onClick={() => window.close()}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Waiting / timed out ----
  if (!received) {
    return (
      <div className="min-h-screen px-5 py-6">
        {heading}
        {timedOut ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-6 text-center">
            <h1 className="text-base font-semibold text-slate-100">
              No job data received
            </h1>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-amber-100/80">
              Make sure you clicked the bookmarklet on a job posting page. If
              you just signed in, close this window and click the bookmark
              again on the posting.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Link
                href="/dashboard"
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500"
              >
                Open dashboard
              </Link>
              <button
                onClick={() => window.close()}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-6 py-14 text-center">
            <div className="flex items-center justify-center gap-3 text-slate-300">
              <Spinner className="h-5 w-5" />
              <span className="text-sm font-medium">
                Waiting for the job page to send its data…
              </span>
            </div>
            <p className="mx-auto mt-3 max-w-xs text-xs leading-relaxed text-slate-500">
              This usually takes a second. Keep the job posting tab open while
              it finishes.
            </p>
          </div>
        )}
      </div>
    );
  }

  // ---- Review form ----
  return (
    <div className="min-h-screen px-5 py-6">
      {heading}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="capture-company" className={labelClass}>
            Company name *
          </label>
          <input
            id="capture-company"
            className={inputClass}
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Acme Corp"
            required
          />
        </div>
        <div>
          <label htmlFor="capture-title" className={labelClass}>
            Job title *
          </label>
          <input
            id="capture-title"
            className={inputClass}
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            placeholder="Senior Software Engineer"
            required
          />
        </div>
        <div>
          <label htmlFor="capture-url" className={labelClass}>
            Job URL
          </label>
          <input
            id="capture-url"
            className={inputClass}
            type="url"
            value={jobUrl}
            onChange={(e) => {
              setJobUrl(e.target.value);
              if (urlWarning) setUrlWarning(null);
            }}
            placeholder="https://…"
          />
          {urlWarning && (
            <p
              role="alert"
              className="mt-1.5 rounded-lg border border-amber-500/40 bg-amber-950/40 px-3 py-2 text-xs text-amber-200"
            >
              {urlWarning}
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="capture-location" className={labelClass}>
              Location
            </label>
            <input
              id="capture-location"
              className={inputClass}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Remote / New York, NY"
            />
          </div>
          <div>
            <label htmlFor="capture-salary" className={labelClass}>
              Salary
            </label>
            <input
              id="capture-salary"
              className={inputClass}
              value={salary}
              onChange={(e) => setSalary(e.target.value)}
              placeholder="$150k–$180k"
            />
          </div>
        </div>
        <div>
          <label htmlFor="capture-status" className={labelClass}>
            Status
          </label>
          <select
            id="capture-status"
            className={inputClass}
            value={status}
            onChange={(e) => setStatus(e.target.value as ApplicationStatus)}
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="capture-description" className={labelClass}>
            Job description
          </label>
          <textarea
            id="capture-description"
            className={`${inputClass} min-h-40 resize-y`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Paste the job description here…"
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => window.close()}
            disabled={saving}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
          >
            {saving && <Spinner className="h-3.5 w-3.5" />}
            Save application
          </button>
        </div>
      </form>
    </div>
  );
}
