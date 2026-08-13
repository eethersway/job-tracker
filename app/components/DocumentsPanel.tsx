"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Markdown } from "@/components/Markdown";
import { Spinner } from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { formatDateTime } from "@/lib/format";
import {
  isGenerating,
  startGeneration,
  subscribeGeneration,
  takeResult,
  type GenerationResult,
} from "@/lib/generation";
import type { DocumentRow, DocumentType } from "@/lib/types";

interface DocumentsPanelProps {
  applicationId: string;
  type: DocumentType;
  /** All documents for this application (both types); panel filters its own. */
  documents: DocumentRow[];
  /** Ask the parent to refetch the documents list. */
  onDocumentsChanged: () => Promise<void> | void;
  /** Used to build a nice download filename, e.g. company name. */
  filenameHint: string;
  /** Fit assessment (applications.callouts_md) — shown on the resume tab. */
  calloutsMd?: string | null;
  /**
   * Ask the parent to refetch the application (resume generation also saves
   * a fresh fit assessment to callouts_md).
   */
  onApplicationChanged?: () => Promise<void> | void;
}

const TYPE_META: Record<
  DocumentType,
  { title: string; generateLabel: string; empty: string }
> = {
  resume: {
    title: "Tailored Resumes",
    generateLabel: "Generate Tailored Resume",
    empty:
      "No resumes generated yet. Generation tailors your master resume (from Settings) to this job description.",
  },
  cover_letter: {
    title: "Cover Letters",
    generateLabel: "Generate Cover Letter",
    empty:
      "No cover letters yet. Generation writes a letter based on your master resume and this job description.",
  },
};

export function DocumentsPanel({
  applicationId,
  type,
  documents,
  onDocumentsChanged,
  filenameHint,
  calloutsMd,
  onApplicationChanged,
}: DocumentsPanelProps) {
  const { showToast } = useToast();
  const meta = TYPE_META[type];

  const docs = documents
    .filter((d) => d.type === type)
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Generation state lives at module scope (lib/generation.ts) so it survives
  // switching tabs/pages mid-generation. Subscribe for re-renders + results.
  const [, setTick] = useState(0);
  const forceRender = () => setTick((t) => t + 1);
  const generating = isGenerating(applicationId, type);

  // Keep latest callbacks in a ref so the subscription effect doesn't churn.
  const handlersRef = useRef({ onDocumentsChanged, onApplicationChanged, showToast });
  handlersRef.current = { onDocumentsChanged, onApplicationChanged, showToast };

  useEffect(() => {
    const consume = (result: GenerationResult | null) => {
      if (!result) return;
      const h = handlersRef.current;
      if (result.ok) {
        h.showToast(
          type === "resume" ? "Resume generated." : "Cover letter generated.",
          "success"
        );
        void (async () => {
          await h.onDocumentsChanged();
          if (type === "resume") await h.onApplicationChanged?.();
          if (result.document_id) setSelectedId(result.document_id);
        })();
      } else {
        h.showToast(
          `Generation failed: ${result.error ?? "unknown error"}`,
          "error"
        );
      }
    };

    // A generation may have finished while this panel was unmounted.
    consume(takeResult(applicationId, type));

    return subscribeGeneration(() => {
      forceRender();
      consume(takeResult(applicationId, type));
    });
  }, [applicationId, type]);

  const selected =
    docs.find((d) => d.id === selectedId) ?? (docs.length > 0 ? docs[0] : null);

  // Reset edit state when switching documents.
  useEffect(() => {
    setEditing(false);
  }, [selected?.id]);

  function generate() {
    startGeneration(applicationId, type);
  }

  async function saveEdit() {
    if (!selected) return;
    setSavingEdit(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("documents")
        .update({ content_md: draft })
        .eq("id", selected.id);
      if (error) throw new Error(error.message);
      showToast("Document saved.", "success");
      setEditing(false);
      await onDocumentsChanged();
    } catch (err) {
      showToast(
        `Could not save: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
        "error"
      );
    } finally {
      setSavingEdit(false);
    }
  }

  async function copyToClipboard() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.content_md);
      showToast("Copied to clipboard.", "success");
    } catch {
      showToast("Copy failed — your browser blocked clipboard access.", "error");
    }
  }

  function download() {
    if (!selected) return;
    const slug = filenameHint
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const date = new Date(selected.created_at).toISOString().slice(0, 10);
    const filename = `${type === "resume" ? "resume" : "cover-letter"}-${
      slug || "jobtracker"
    }-${date}.md`;
    const blob = new Blob([selected.content_md], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const toolbarButton =
    "rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800 disabled:opacity-50";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-200">{meta.title}</h3>
        <button
          onClick={generate}
          disabled={generating}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-60"
        >
          {generating && <Spinner className="h-4 w-4" />}
          {generating
            ? "Generating (runs company research first if needed - up to 2 min)"
            : meta.generateLabel}
        </button>
      </div>

      {type === "resume" && calloutsMd && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
          <div className="mb-2 flex items-center gap-2">
            <svg
              className="h-4 w-4 text-amber-400"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M10 1a6 6 0 00-3.815 10.631C7.237 12.5 8 13.443 8 14.456v.644a.75.75 0 00.572.729 6.016 6.016 0 002.856 0A.75.75 0 0012 15.1v-.644c0-1.013.762-1.957 1.815-2.825A6 6 0 0010 1zM8.863 17.414a.75.75 0 00-.226 1.483 9.066 9.066 0 002.726 0 .75.75 0 00-.226-1.483 7.553 7.553 0 01-2.274 0z"
                clipRule="evenodd"
              />
            </svg>
            <h4 className="text-sm font-semibold text-amber-300">Call outs</h4>
          </div>
          <p className="mb-3 text-xs text-slate-400">
            How your background fits this role — generated with your latest
            resume.
          </p>
          <Markdown>{calloutsMd}</Markdown>
        </div>
      )}

      {docs.length === 0 ? (
        !generating && (
          <div className="rounded-xl border border-dashed border-slate-800 p-10 text-center">
            <p className="mx-auto max-w-md text-sm text-slate-400">
              {meta.empty}
            </p>
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
          {/* Version list, newest first */}
          <div className="space-y-1.5">
            {docs.map((doc, i) => {
              const isSelected = selected?.id === doc.id;
              return (
                <button
                  key={doc.id}
                  onClick={() => setSelectedId(doc.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition ${
                    isSelected
                      ? "border-sky-500/50 bg-sky-500/10 text-slate-200"
                      : "border-slate-800 bg-slate-900/40 text-slate-400 hover:border-slate-600"
                  }`}
                >
                  <div className="font-medium">
                    Version {docs.length - i}
                    {i === 0 && (
                      <span className="ml-1.5 rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
                        Latest
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-slate-500">
                    {formatDateTime(doc.created_at)}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Viewer / editor */}
          {selected && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40">
              <div className="flex flex-wrap items-center justify-end gap-2 border-b border-slate-800 px-4 py-2.5">
                {editing ? (
                  <>
                    <button
                      onClick={() => setEditing(false)}
                      disabled={savingEdit}
                      className={toolbarButton}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void saveEdit()}
                      disabled={savingEdit}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
                    >
                      {savingEdit && <Spinner className="h-3 w-3" />}
                      Save
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setDraft(selected.content_md);
                        setEditing(true);
                      }}
                      className={toolbarButton}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => void copyToClipboard()}
                      className={toolbarButton}
                    >
                      Copy
                    </button>
                    <button onClick={download} className={toolbarButton}>
                      Download .md
                    </button>
                    <button
                      onClick={() =>
                        window.open(
                          `/application/${applicationId}/print/${selected.id}`,
                          "_blank",
                          "noopener"
                        )
                      }
                      className={toolbarButton}
                      title="Open a print-ready view to save as PDF"
                    >
                      PDF
                    </button>
                  </>
                )}
              </div>
              <div className="p-5">
                {editing ? (
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    className="min-h-[420px] w-full resize-y rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-200 outline-none focus:border-sky-500"
                    aria-label="Edit document markdown"
                  />
                ) : (
                  <Markdown>{selected.content_md}</Markdown>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
