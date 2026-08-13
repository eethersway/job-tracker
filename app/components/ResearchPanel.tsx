"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Markdown } from "@/components/Markdown";
import { Spinner } from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { formatDateTime } from "@/lib/format";
import type { Company, ResearchCompanyResponse } from "@/lib/types";

interface ResearchPanelProps {
  applicationId: string;
  company: Company | null;
  /** Refetch the application + company after research completes. */
  onResearchComplete: () => Promise<void> | void;
}

function FactItem({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-slate-200">{value}</dd>
    </div>
  );
}

export function ResearchPanel({
  applicationId,
  company,
  onResearchComplete,
}: ResearchPanelProps) {
  const { showToast } = useToast();
  const [running, setRunning] = useState(false);

  async function runResearch() {
    setRunning(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke(
        "research-company",
        { body: { application_id: applicationId } }
      );
      if (error) throw new Error(error.message);
      const result = data as ResearchCompanyResponse | null;
      if (!result?.ok) {
        throw new Error(result?.error ?? "Research function reported failure.");
      }
      showToast("Company research complete.", "success");
      await onResearchComplete();
    } catch (err) {
      showToast(
        `Research failed: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
        "error"
      );
    } finally {
      setRunning(false);
    }
  }

  const hasFacts =
    company &&
    (company.summary ||
      company.size ||
      company.industry ||
      company.hq ||
      company.funding ||
      company.products);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">
            Company Research
          </h3>
          {company?.researched_at && (
            <p className="mt-0.5 text-xs text-slate-500">
              Last researched {formatDateTime(company.researched_at)}
            </p>
          )}
        </div>
        <button
          onClick={() => void runResearch()}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-60"
        >
          {running && <Spinner className="h-4 w-4" />}
          {running
            ? "Researching… (can take a minute)"
            : company?.research_md
              ? "Re-run Research"
              : "Run Research"}
        </button>
      </div>

      {hasFacts && company && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          {company.summary && (
            <p className="mb-4 text-sm leading-relaxed text-slate-300">
              {company.summary}
            </p>
          )}
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FactItem label="Size" value={company.size} />
            <FactItem label="Industry" value={company.industry} />
            <FactItem label="HQ" value={company.hq} />
            <FactItem label="Funding" value={company.funding} />
            <FactItem label="Products" value={company.products} />
            <FactItem label="Recent news" value={company.recent_news} />
          </dl>
          {company.website && (
            <a
              href={company.website}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block text-sm text-sky-400 underline-offset-2 hover:underline"
            >
              {company.website}
            </a>
          )}
        </div>
      )}

      {company?.research_md ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <Markdown>{company.research_md}</Markdown>
        </div>
      ) : (
        !running && (
          <div className="rounded-xl border border-dashed border-slate-800 p-10 text-center">
            <p className="text-sm text-slate-400">
              No research yet. Click{" "}
              <span className="font-medium text-slate-300">Run Research</span>{" "}
              to have AI gather a company brief — size, funding, products, and
              recent news. It usually takes 30–90 seconds.
            </p>
          </div>
        )
      )}
    </div>
  );
}
