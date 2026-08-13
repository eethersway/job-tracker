"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/AppShell";
import { AddApplicationModal } from "@/components/AddApplicationModal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LoadingBlock } from "@/components/Spinner";
import { StatusSelect } from "@/components/StatusSelect";
import { useToast } from "@/components/Toast";
import { formatDate, formatRelative } from "@/lib/format";
import {
  STATUS_DOT_CLASSES,
  STATUS_LABELS,
  STATUS_ORDER,
} from "@/lib/status";
import type { Application, ApplicationStatus, Profile } from "@/lib/types";

type SortKey = "date_added" | "updated_at" | "company_name";
type SortDir = "asc" | "desc";

export default function DashboardPage() {
  const { showToast } = useToast();
  const router = useRouter();

  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checkingOnboarding, setCheckingOnboarding] = useState(true);

  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | null>(
    null
  );
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date_added");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [showAddModal, setShowAddModal] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Application | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [savingStatusId, setSavingStatusId] = useState<string | null>(null);

  const fetchApplications = useCallback(async () => {
    setLoadError(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("applications")
        .select("*")
        .order("date_added", { ascending: false });
      if (error) throw new Error(error.message);
      setApplications((data as Application[]) ?? []);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load applications."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchApplications();
  }, [fetchApplications]);

  // Send first-time users to the welcome checklist until they finish setup
  // (or dismiss it).
  useEffect(() => {
    let cancelled = false;
    async function checkOnboarding() {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("profile")
          .select("*")
          .maybeSingle();
        if (error) throw new Error(error.message);
        const profile = (data as Profile | null) ?? null;
        const incomplete =
          !profile ||
          ((!profile.anthropic_api_key || !profile.master_resume_md) &&
            !profile.onboarding_dismissed);
        if (!cancelled && incomplete) {
          router.push("/welcome");
          return;
        }
      } catch {
        // If the check fails (e.g. offline), just show the dashboard.
      }
      if (!cancelled) setCheckingOnboarding(false);
    }
    void checkOnboarding();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Counts per status (over ALL applications, not the filtered view).
  const statusCounts = useMemo(() => {
    const counts = {} as Record<ApplicationStatus, number>;
    for (const s of STATUS_ORDER) counts[s] = 0;
    for (const app of applications) counts[app.status] += 1;
    return counts;
  }, [applications]);

  const visibleApplications = useMemo(() => {
    let rows = applications;
    if (statusFilter) {
      rows = rows.filter((a) => a.status === statusFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (a) =>
          a.company_name.toLowerCase().includes(q) ||
          a.job_title.toLowerCase().includes(q) ||
          (a.notes ?? "").toLowerCase().includes(q)
      );
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortKey === "company_name") {
        return a.company_name.localeCompare(b.company_name) * dir;
      }
      const av = new Date(a[sortKey]).getTime() || 0;
      const bv = new Date(b[sortKey]).getTime() || 0;
      return (av - bv) * dir;
    });
  }, [applications, statusFilter, search, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "company_name" ? "asc" : "desc");
    }
  }

  async function handleStatusChange(app: Application, next: ApplicationStatus) {
    const previous = app.status;
    setSavingStatusId(app.id);
    // Optimistic update.
    setApplications((prev) =>
      prev.map((a) => (a.id === app.id ? { ...a, status: next } : a))
    );
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("applications")
        .update({ status: next, updated_at: new Date().toISOString() })
        .eq("id", app.id);
      if (error) throw new Error(error.message);
    } catch (err) {
      // Roll back.
      setApplications((prev) =>
        prev.map((a) => (a.id === app.id ? { ...a, status: previous } : a))
      );
      showToast(
        `Could not update status: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
        "error"
      );
    } finally {
      setSavingStatusId(null);
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("applications")
        .delete()
        .eq("id", pendingDelete.id);
      if (error) throw new Error(error.message);
      setApplications((prev) =>
        prev.filter((a) => a.id !== pendingDelete.id)
      );
      showToast("Application deleted.", "success");
      setPendingDelete(null);
    } catch (err) {
      showToast(
        `Could not delete: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
        "error"
      );
    } finally {
      setDeleting(false);
    }
  }

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const thButton =
    "cursor-pointer select-none text-left text-xs font-medium uppercase tracking-wide text-slate-400 hover:text-slate-200";

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">
            Applications
          </h1>
          <p className="mt-0.5 text-sm text-slate-400">
            {applications.length} total
            {statusFilter
              ? ` · filtered to ${STATUS_LABELS[statusFilter]}`
              : ""}
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500"
        >
          + Add Application
        </button>
      </div>

      {/* Status chips */}
      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_ORDER.map((status) => {
          const active = statusFilter === status;
          return (
            <button
              key={status}
              onClick={() => setStatusFilter(active ? null : status)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                active
                  ? "border-sky-500 bg-sky-500/15 text-sky-300"
                  : "border-slate-700 bg-slate-900/60 text-slate-400 hover:border-slate-500 hover:text-slate-200"
              }`}
              aria-pressed={active}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASSES[status]}`}
              />
              {STATUS_LABELS[status]}
              <span className="text-slate-500">{statusCounts[status]}</span>
            </button>
          );
        })}
        {statusFilter && (
          <button
            onClick={() => setStatusFilter(null)}
            className="rounded-full px-3 py-1 text-xs text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
          >
            Clear filter
          </button>
        )}
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company, title, or notes…"
          className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none transition focus:border-sky-500"
          aria-label="Search applications"
        />
      </div>

      {/* Content */}
      {loading || checkingOnboarding ? (
        <LoadingBlock label="Loading applications…" />
      ) : loadError ? (
        <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-6 text-center">
          <p className="text-sm text-red-300">
            Could not load applications: {loadError}
          </p>
          <button
            onClick={() => {
              setLoading(true);
              void fetchApplications();
            }}
            className="mt-3 rounded-lg border border-slate-700 px-4 py-1.5 text-sm text-slate-300 transition hover:bg-slate-800"
          >
            Retry
          </button>
        </div>
      ) : applications.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-12 text-center">
          <p className="text-3xl">📋</p>
          <h2 className="mt-3 text-base font-semibold text-slate-200">
            No applications yet
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">
            Track your first job application by adding it manually, or install
            the Chrome extension to capture postings straight from job boards.
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <button
              onClick={() => setShowAddModal(true)}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500"
            >
              + Add Application
            </button>
            <Link
              href="/settings"
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
            >
              Extension setup
            </Link>
          </div>
        </div>
      ) : visibleApplications.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-10 text-center">
          <p className="text-sm text-slate-400">
            No applications match your current search or filter.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/40">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="px-4 py-3">
                  <button
                    className={thButton}
                    onClick={() => toggleSort("company_name")}
                  >
                    Company{sortIndicator("company_name")}
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                  Job Title
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                  Status
                </th>
                <th className="px-4 py-3">
                  <button
                    className={thButton}
                    onClick={() => toggleSort("date_added")}
                  >
                    Date Added{sortIndicator("date_added")}
                  </button>
                </th>
                <th className="px-4 py-3">
                  <button
                    className={thButton}
                    onClick={() => toggleSort("updated_at")}
                  >
                    Last Updated{sortIndicator("updated_at")}
                  </button>
                </th>
                <th className="px-4 py-3" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visibleApplications.map((app) => (
                <tr
                  key={app.id}
                  className="border-b border-slate-800/60 transition last:border-b-0 hover:bg-slate-800/30"
                >
                  <td className="px-4 py-3 font-medium text-slate-200">
                    {app.company_name}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/application/${app.id}`}
                      className="text-sky-400 underline-offset-2 hover:underline"
                    >
                      {app.job_title}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusSelect
                      value={app.status}
                      saving={savingStatusId === app.id}
                      onChange={(next) => handleStatusChange(app, next)}
                    />
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {formatDate(app.date_added)}
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {formatRelative(app.updated_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setPendingDelete(app)}
                      className="rounded-lg p-1.5 text-slate-500 transition hover:bg-red-500/10 hover:text-red-400"
                      aria-label={`Delete application at ${app.company_name}`}
                      title="Delete"
                    >
                      <svg
                        className="h-4 w-4"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482 41.03 41.03 0 00-2.365-.298V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAddModal && (
        <AddApplicationModal
          onClose={() => setShowAddModal(false)}
          onCreated={() => {
            setLoading(true);
            void fetchApplications();
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete application"
          message={`Delete the application for "${pendingDelete.job_title}" at ${pendingDelete.company_name}? This also removes its generated documents and cannot be undone.`}
          busy={deleting}
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </AppShell>
  );
}
