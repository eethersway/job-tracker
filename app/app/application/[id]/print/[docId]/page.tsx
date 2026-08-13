"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { createClient } from "@/lib/supabase/client";
import type { DocumentRow, Profile } from "@/lib/types";

/**
 * Print-ready view of a generated document. Renders the markdown in a clean
 * light layout and auto-opens the browser print dialog so the user can save
 * it as a PDF. Opened in a new tab from the PDF button on the documents
 * panel.
 */
export default function PrintDocumentPage() {
  const params = useParams<{ id: string; docId: string }>();

  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const supabase = createClient();
        const [docRes, profileRes, appRes] = await Promise.all([
          supabase
            .from("documents")
            .select("*")
            .eq("id", params.docId)
            .eq("application_id", params.id)
            .maybeSingle(),
          supabase.from("profile").select("*").maybeSingle(),
          supabase
            .from("applications")
            .select("company_name")
            .eq("id", params.id)
            .maybeSingle(),
        ]);
        if (docRes.error) throw new Error(docRes.error.message);
        if (!docRes.data) throw new Error("Document not found.");
        if (cancelled) return;
        setDoc(docRes.data as DocumentRow);
        setProfile((profileRes.data as Profile | null) ?? null);
        setCompanyName(
          (appRes.data as { company_name: string } | null)?.company_name ?? null
        );
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : "Failed to load document."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [params.docId, params.id]);

  // Set a useful tab title (it becomes the default PDF filename) and open
  // the print dialog shortly after the content renders.
  useEffect(() => {
    if (!doc) return;
    const typeLabel = doc.type === "resume" ? "Resume" : "Cover Letter";
    const parts = [profile?.full_name, typeLabel, companyName].filter(Boolean);
    document.title = parts.join(" - ") || typeLabel;
    const timer = setTimeout(() => {
      window.print();
    }, 600);
    return () => clearTimeout(timer);
  }, [doc, profile, companyName]);

  return (
    <div className="print-doc-page">
      {/* Light-theme overrides: keep the app's dark globals out of print. */}
      <style>{`
        html {
          color-scheme: light;
        }
        html, body {
          background: #ffffff !important;
          color: #111111 !important;
        }
        .print-doc-page {
          min-height: 100vh;
          background: #ffffff !important;
          color: #111111 !important;
          font-family: Georgia, "Times New Roman", Cambria, serif;
        }
        .print-doc-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          max-width: 52rem;
          margin: 0 auto;
          padding: 0.9rem 1.5rem;
          border-bottom: 1px solid #e5e7eb;
          font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI",
            Roboto, Arial, sans-serif;
        }
        .print-doc-toolbar p {
          margin: 0;
          font-size: 0.8rem;
          color: #6b7280;
        }
        .print-doc-toolbar button {
          border: 1px solid #d1d5db;
          border-radius: 0.5rem;
          background: #f9fafb;
          color: #111111;
          font-size: 0.8rem;
          padding: 0.4rem 0.9rem;
          cursor: pointer;
        }
        .print-doc-toolbar button:hover {
          background: #f3f4f6;
        }
        .print-doc-body {
          max-width: 52rem;
          margin: 0 auto;
          padding: 2rem 1.5rem 3rem;
          font-size: 10.5pt;
          line-height: 1.45;
          color: #111111;
        }
        .print-doc-body h1 {
          font-size: 19pt;
          font-weight: 700;
          letter-spacing: 0.01em;
          margin: 0 0 0.35em;
          color: #000000;
        }
        .print-doc-body h2 {
          font-size: 12pt;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          border-bottom: 1px solid #444444;
          padding-bottom: 0.15em;
          margin: 1.1em 0 0.45em;
          color: #000000;
        }
        .print-doc-body h3 {
          font-size: 11pt;
          font-weight: 700;
          margin: 0.85em 0 0.25em;
          color: #000000;
        }
        .print-doc-body h4 {
          font-size: 10.5pt;
          font-weight: 700;
          margin: 0.7em 0 0.2em;
          color: #000000;
        }
        .print-doc-body p {
          margin: 0.45em 0;
        }
        .print-doc-body ul,
        .print-doc-body ol {
          margin: 0.35em 0;
          padding-left: 1.35em;
        }
        .print-doc-body ul {
          list-style: disc;
        }
        .print-doc-body ol {
          list-style: decimal;
        }
        .print-doc-body li {
          margin: 0.18em 0;
        }
        .print-doc-body strong {
          color: #000000;
        }
        .print-doc-body a {
          color: #111111;
          text-decoration: none;
        }
        .print-doc-body hr {
          border: none;
          border-top: 1px solid #999999;
          margin: 0.9em 0;
        }
        .print-doc-body blockquote {
          border-left: 2px solid #999999;
          margin: 0.6em 0;
          padding-left: 0.9em;
          color: #333333;
        }
        .print-doc-body code {
          font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
          font-size: 9.5pt;
        }
        .print-doc-status {
          font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI",
            Roboto, Arial, sans-serif;
          text-align: center;
          padding: 4rem 1.5rem;
          font-size: 0.9rem;
          color: #6b7280;
        }
        @page {
          margin: 1.6cm;
        }
        @media print {
          .print-doc-toolbar,
          .print-doc-status {
            display: none !important;
          }
          .print-doc-body {
            max-width: none;
            padding: 0;
          }
        }
      `}</style>

      {loading ? (
        <div className="print-doc-status">Loading document…</div>
      ) : loadError || !doc ? (
        <div className="print-doc-status">
          {loadError ?? "Document not found."}
        </div>
      ) : (
        <>
          <div className="print-doc-toolbar">
            <p>
              Print dialog opens automatically — choose &ldquo;Save as
              PDF&rdquo; as the destination.
            </p>
            <button onClick={() => window.print()}>Print / Save as PDF</button>
          </div>
          <div className="print-doc-body">
            <ReactMarkdown>{doc.content_md}</ReactMarkdown>
          </div>
        </>
      )}
    </div>
  );
}
