"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { describeInvokeError } from "@/lib/generation";
import { safeHref } from "@/lib/safe-url";
import { STATUS_LABELS, STATUS_ORDER } from "@/lib/status";
import type { ApplicationStatus, ImportUrlResponse } from "@/lib/types";

interface AddApplicationModalProps {
  onClose: () => void;
  /** Called after a successful insert so the parent can refetch. */
  onCreated: () => void;
}

const inputClass =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none transition focus:border-sky-500";

const labelClass = "mb-1 block text-xs font-medium text-slate-400";

export function AddApplicationModal({
  onClose,
  onCreated,
}: AddApplicationModalProps) {
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [urlWarning, setUrlWarning] = useState<string | null>(null);

  // Link import (edge function `import-url`) — prefills the form below.
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importedFrom, setImportedFrom] = useState<string | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [salary, setSalary] = useState("");
  const [dateApplied, setDateApplied] = useState("");
  const [status, setStatus] = useState<ApplicationStatus>("new");

  /**
   * Import a posting by URL. Only fills fields the user has left empty, so
   * anything already typed is never clobbered.
   */
  async function handleImport() {
    const url = importUrl.trim();
    if (!url) {
      setImportError("Paste the link to the job posting first.");
      return;
    }
    setImporting(true);
    setImportError(null);
    setImportedFrom(null);
    setImportNote(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke("import-url", {
        body: { url },
      });

      // Non-2xx (400/422/429) responses arrive as an invoke error whose
      // context holds the JSON body with the user-facing message. Rate limits
      // get the server's own wording, same as any other message.
      if (error) {
        const info = await describeInvokeError(error);
        setImportError(
          info.rateLimited
            ? `${info.message} (You can still paste the details in manually below.)`
            : info.message
        );
        return;
      }

      const result = data as ImportUrlResponse | null;
      if (!result?.ok) {
        setImportError(
          result?.error ??
            "Could not read that posting. Paste the details in manually below."
        );
        return;
      }

      const fields = result.fields ?? {};
      const fill = (
        value: string | null | undefined,
        current: string,
        setter: (v: string) => void
      ) => {
        const next = (value ?? "").trim();
        if (next && !current.trim()) setter(next);
      };
      fill(fields.company_name, companyName, setCompanyName);
      fill(fields.job_title, jobTitle, setJobTitle);
      // Scraped URLs are untrusted: only accept absolute http(s) links, so a
      // `javascript:` value can never be stored and later rendered as a link.
      const importedUrl = (fields.job_url ?? url) || "";
      if (safeHref(importedUrl)) {
        fill(importedUrl, jobUrl, setJobUrl);
      } else if (importedUrl.trim()) {
        setUrlWarning(
          "The imported link was not a normal web address, so it was left out."
        );
      }
      fill(fields.job_description, description, setDescription);
      fill(fields.location, location, setLocation);
      fill(fields.salary, salary, setSalary);

      let hostname = url;
      try {
        hostname = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        // Keep the raw string if it isn't parseable.
      }
      setImportedFrom(hostname);
      if (result.partial && result.note) setImportNote(result.note);
    } catch (err) {
      setImportError(
        `Could not import that link: ${
          err instanceof Error ? err.message : "unknown error"
        }. You can still paste the details in manually below.`
      );
    } finally {
      setImporting(false);
    }
  }

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
      const { error } = await supabase.from("applications").insert({
        company_name: companyName.trim(),
        job_title: jobTitle.trim(),
        job_url: jobUrl.trim() || null,
        job_description: description.trim() || null,
        location: location.trim() || null,
        salary: salary.trim() || null,
        date_applied: dateApplied || null,
        status,
        source: "manual",
      });
      if (error) throw new Error(error.message);
      showToast("Application added.", "success");
      onCreated();
      onClose();
    } catch (err) {
      showToast(
        `Could not add application: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
        "error"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Add Application" onClose={onClose} widthClass="max-w-xl">
      {/* Import by link — prefills the form below */}
      <div className="mb-5 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <label htmlFor="import-url" className={labelClass}>
          Paste a job link
        </label>
        <div className="flex gap-2">
          <input
            id="import-url"
            type="url"
            className={inputClass}
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleImport();
              }
            }}
            placeholder="https://boards.greenhouse.io/…"
            disabled={importing}
          />
          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={importing}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
          >
            {importing && <Spinner className="h-3.5 w-3.5" />}
            {importing ? "Fetching the posting…" : "Import"}
          </button>
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          Works with most job boards (Greenhouse, Lever, Ashby, Workday,
          LinkedIn). Some sites block automated reads, so you may need to
          paste the description yourself.
        </p>

        {importedFrom && (
          <p className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
            Imported from {importedFrom}. Review the fields below before
            saving.
          </p>
        )}
        {importNote && (
          <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
            {importNote}
          </p>
        )}
        {importError && (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-amber-500/40 bg-amber-950/40 px-3 py-2 text-xs text-amber-200"
          >
            {importError}
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="add-company" className={labelClass}>
              Company name *
            </label>
            <input
              id="add-company"
              className={inputClass}
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Corp"
              autoFocus
              required
            />
          </div>
          <div>
            <label htmlFor="add-title" className={labelClass}>
              Job title *
            </label>
            <input
              id="add-title"
              className={inputClass}
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="Senior Software Engineer"
              required
            />
          </div>
        </div>

        <div>
          <label htmlFor="add-url" className={labelClass}>
            Job URL
          </label>
          <input
            id="add-url"
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

        <div>
          <label htmlFor="add-description" className={labelClass}>
            Job description
          </label>
          <textarea
            id="add-description"
            className={`${inputClass} min-h-28 resize-y`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Paste the job description here…"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="add-location" className={labelClass}>
              Location
            </label>
            <input
              id="add-location"
              className={inputClass}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Remote / New York, NY"
            />
          </div>
          <div>
            <label htmlFor="add-salary" className={labelClass}>
              Salary
            </label>
            <input
              id="add-salary"
              className={inputClass}
              value={salary}
              onChange={(e) => setSalary(e.target.value)}
              placeholder="$150k–$180k"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="add-date-applied" className={labelClass}>
              Date applied
            </label>
            <input
              id="add-date-applied"
              className={inputClass}
              type="date"
              value={dateApplied}
              onChange={(e) => setDateApplied(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="add-status" className={labelClass}>
              Status
            </label>
            <select
              id="add-status"
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
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
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
            Add application
          </button>
        </div>
      </form>
    </Modal>
  );
}
