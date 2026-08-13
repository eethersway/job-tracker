"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/AppShell";
import { DocumentsPanel } from "@/components/DocumentsPanel";
import { ResearchPanel } from "@/components/ResearchPanel";
import { LoadingBlock, Spinner } from "@/components/Spinner";
import { StatusSelect } from "@/components/StatusSelect";
import { useToast } from "@/components/Toast";
import { formatDate } from "@/lib/format";
import type {
  Application,
  ApplicationStatus,
  Company,
  DocumentRow,
} from "@/lib/types";

type TabKey = "description" | "research" | "resume" | "cover_letter" | "notes";

const TABS: { key: TabKey; label: string }[] = [
  { key: "description", label: "Job Description" },
  { key: "research", label: "Company Research" },
  { key: "resume", label: "Resume" },
  { key: "cover_letter", label: "Cover Letter" },
  { key: "notes", label: "Notes" },
];

export default function ApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const applicationId = params.id;
  const { showToast } = useToast();

  const [application, setApplication] = useState<Application | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [activeTab, setActiveTab] = useState<TabKey>("description");
  const [savingStatus, setSavingStatus] = useState(false);

  // Editable header fields
  const [headerCompany, setHeaderCompany] = useState("");
  const [headerTitle, setHeaderTitle] = useState("");
  const [headerUrl, setHeaderUrl] = useState("");

  // Job description editing
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [savingDescription, setSavingDescription] = useState(false);

  // Notes autosave
  const [notes, setNotes] = useState("");
  const [notesStatus, setNotesStatus] = useState<
    "idle" | "dirty" | "saving" | "saved" | "error"
  >("idle");
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesLoaded = useRef(false);

  const fetchDocuments = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("application_id", applicationId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      setDocuments((data as DocumentRow[]) ?? []);
    } catch (err) {
      showToast(
        `Could not load documents: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
        "error"
      );
    }
  }, [applicationId, showToast]);

  const fetchApplication = useCallback(async () => {
    setLoadError(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("applications")
        .select("*")
        .eq("id", applicationId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) {
        setNotFound(true);
        return;
      }
      const app = data as Application;
      setApplication(app);
      setHeaderCompany(app.company_name);
      setHeaderTitle(app.job_title);
      setHeaderUrl(app.job_url ?? "");
      if (!notesLoaded.current) {
        setNotes(app.notes ?? "");
        notesLoaded.current = true;
      }

      if (app.company_id) {
        const { data: companyData, error: companyError } = await supabase
          .from("companies")
          .select("*")
          .eq("id", app.company_id)
          .maybeSingle();
        if (!companyError && companyData) {
          setCompany(companyData as Company);
        }
      } else {
        setCompany(null);
      }
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load application."
      );
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    void fetchApplication();
    void fetchDocuments();
  }, [fetchApplication, fetchDocuments]);

  /** Persist a partial update and merge it into local state. */
  const updateApplication = useCallback(
    async (patch: Partial<Application>) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("applications")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", applicationId);
      if (error) throw new Error(error.message);
      setApplication((prev) => (prev ? { ...prev, ...patch } : prev));
    },
    [applicationId]
  );

  async function handleStatusChange(next: ApplicationStatus) {
    if (!application) return;
    setSavingStatus(true);
    try {
      await updateApplication({ status: next });
    } catch (err) {
      showToast(
        `Could not update status: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
        "error"
      );
    } finally {
      setSavingStatus(false);
    }
  }

  async function saveHeaderField(
    field: "company_name" | "job_title" | "job_url",
    rawValue: string
  ) {
    if (!application) return;
    const value = rawValue.trim();
    const current =
      field === "job_url"
        ? application.job_url ?? ""
        : application[field];
    if (value === current) return;
    if ((field === "company_name" || field === "job_title") && !value) {
      showToast("This field cannot be empty.", "error");
      setHeaderCompany(application.company_name);
      setHeaderTitle(application.job_title);
      return;
    }
    try {
      await updateApplication({
        [field]: field === "job_url" ? value || null : value,
      });
    } catch (err) {
      showToast(
        `Could not save: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
        "error"
      );
    }
  }

  async function saveDescription() {
    setSavingDescription(true);
    try {
      await updateApplication({
        job_description: descriptionDraft.trim() || null,
      });
      setEditingDescription(false);
      showToast("Job description saved.", "success");
    } catch (err) {
      showToast(
        `Could not save: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
        "error"
      );
    } finally {
      setSavingDescription(false);
    }
  }

  // ---- Notes autosave (debounced 900ms) ----
  function handleNotesChange(value: string) {
    setNotes(value);
    setNotesStatus("dirty");
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => {
      void saveNotes(value);
    }, 900);
  }

  const saveNotes = useCallback(
    async (value: string) => {
      setNotesStatus("saving");
      try {
        const supabase = createClient();
        const { error } = await supabase
          .from("applications")
          .update({
            notes: value || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", applicationId);
        if (error) throw new Error(error.message);
        setNotesStatus("saved");
      } catch {
        setNotesStatus("error");
      }
    },
    [applicationId]
  );

  useEffect(() => {
    return () => {
      if (notesTimer.current) clearTimeout(notesTimer.current);
    };
  }, []);

  const headerInputClass =
    "rounded-lg border border-transparent bg-transparent px-2 py-1 outline-none transition hover:border-slate-700 focus:border-sky-500 focus:bg-slate-950";

  if (loading) {
    return (
      <AppShell>
        <LoadingBlock label="Loading application…" />
      </AppShell>
    );
  }

  if (notFound || !application) {
    return (
      <AppShell>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-12 text-center">
          <h2 className="text-base font-semibold text-slate-200">
            {notFound ? "Application not found" : "Something went wrong"}
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            {notFound
              ? "It may have been deleted."
              : loadError ?? "Failed to load this application."}
          </p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
          >
            Back to dashboard
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Link
        href="/"
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-400 transition hover:text-slate-200"
      >
        ← Back to dashboard
      </Link>

      {/* Editable header */}
      <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <input
              value={headerTitle}
              onChange={(e) => setHeaderTitle(e.target.value)}
              onBlur={() => void saveHeaderField("job_title", headerTitle)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className={`${headerInputClass} -mx-2 block w-full text-xl font-semibold text-slate-100`}
              aria-label="Job title"
            />
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-400">
              <input
                value={headerCompany}
                onChange={(e) => setHeaderCompany(e.target.value)}
                onBlur={() =>
                  void saveHeaderField("company_name", headerCompany)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                className={`${headerInputClass} font-medium text-slate-300`}
                aria-label="Company name"
              />
              <span className="text-slate-600">·</span>
              <input
                value={headerUrl}
                onChange={(e) => setHeaderUrl(e.target.value)}
                onBlur={() => void saveHeaderField("job_url", headerUrl)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                placeholder="Job posting URL…"
                className={`${headerInputClass} w-56 text-slate-400 placeholder-slate-600`}
                aria-label="Job URL"
              />
              {application.job_url && (
                <a
                  href={application.job_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-800 hover:text-sky-400"
                  title="Open job posting in a new tab"
                  aria-label="Open job posting in a new tab"
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z"
                      clipRule="evenodd"
                    />
                    <path
                      fillRule="evenodd"
                      d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </a>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              {application.location && <span>{application.location}</span>}
              {application.salary && <span>{application.salary}</span>}
              <span>Added {formatDate(application.date_added)}</span>
              {application.date_applied && (
                <span>Applied {formatDate(application.date_applied)}</span>
              )}
              <span className="capitalize">
                Source: {application.source}
              </span>
            </div>
          </div>
          <StatusSelect
            value={application.status}
            saving={savingStatus}
            onChange={handleStatusChange}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-5 flex flex-wrap gap-1 border-b border-slate-800">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm transition ${
              activeTab === tab.key
                ? "border-sky-500 text-slate-100"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "description" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200">
              Job Description
            </h3>
            {editingDescription ? (
              <div className="flex gap-2">
                <button
                  onClick={() => setEditingDescription(false)}
                  disabled={savingDescription}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void saveDescription()}
                  disabled={savingDescription}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
                >
                  {savingDescription && <Spinner className="h-3 w-3" />}
                  Save
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setDescriptionDraft(application.job_description ?? "");
                  setEditingDescription(true);
                }}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800"
              >
                Edit
              </button>
            )}
          </div>
          {editingDescription ? (
            <textarea
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              className="min-h-[400px] w-full resize-y rounded-xl border border-slate-700 bg-slate-950 p-4 text-sm leading-relaxed text-slate-200 outline-none focus:border-sky-500"
              aria-label="Edit job description"
            />
          ) : application.job_description ? (
            <div className="whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-900/40 p-5 text-sm leading-relaxed text-slate-300">
              {application.job_description}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-800 p-10 text-center">
              <p className="text-sm text-slate-400">
                No job description saved. Click{" "}
                <span className="font-medium text-slate-300">Edit</span> to
                paste one — it&apos;s used for resume and cover letter
                generation.
              </p>
            </div>
          )}
        </div>
      )}

      {activeTab === "research" && (
        <ResearchPanel
          applicationId={application.id}
          company={company}
          onResearchComplete={fetchApplication}
        />
      )}

      {activeTab === "resume" && (
        <DocumentsPanel
          applicationId={application.id}
          type="resume"
          documents={documents}
          onDocumentsChanged={fetchDocuments}
          filenameHint={application.company_name}
          calloutsMd={application.callouts_md}
          onApplicationChanged={fetchApplication}
        />
      )}

      {activeTab === "cover_letter" && (
        <DocumentsPanel
          applicationId={application.id}
          type="cover_letter"
          documents={documents}
          onDocumentsChanged={fetchDocuments}
          filenameHint={application.company_name}
        />
      )}

      {activeTab === "notes" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200">Notes</h3>
            <span
              className={`text-xs ${
                notesStatus === "error" ? "text-red-400" : "text-slate-500"
              }`}
              aria-live="polite"
            >
              {notesStatus === "saving" && "Saving…"}
              {notesStatus === "saved" && "Saved"}
              {notesStatus === "dirty" && "Unsaved changes…"}
              {notesStatus === "error" && "Save failed — will retry on next edit"}
            </span>
          </div>
          <textarea
            value={notes}
            onChange={(e) => handleNotesChange(e.target.value)}
            placeholder="Interview prep, contacts, follow-up dates, gut feelings…"
            className="min-h-[380px] w-full resize-y rounded-xl border border-slate-700 bg-slate-950 p-4 text-sm leading-relaxed text-slate-200 placeholder-slate-600 outline-none focus:border-sky-500"
            aria-label="Application notes"
          />
          <p className="text-xs text-slate-600">
            Notes save automatically as you type.
          </p>
        </div>
      )}
    </AppShell>
  );
}
