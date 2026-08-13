"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/AppShell";
import { ExtensionSteps } from "@/components/ExtensionSteps";
import { LoadingBlock, Spinner } from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { buildBookmarklet } from "@/lib/extract-page";
import {
  COVER_LETTER_PRICE_CENTS,
  RESEARCH_PRICE_CENTS,
  RESUME_PRICE_CENTS,
  formatCents,
} from "@/lib/pricing";
import type { Profile } from "@/lib/types";

const inputCls =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none transition focus:border-sky-500";

/** Numbered circle that turns into a green check once the step is done. */
function StepBadge({ n, done }: { n: number; done: boolean }) {
  return done ? (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
      <svg
        className="h-4 w-4"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
          clipRule="evenodd"
        />
      </svg>
      <span className="sr-only">Step {n} complete</span>
    </span>
  ) : (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-sm font-semibold text-slate-400">
      {n}
    </span>
  );
}

export default function WelcomePage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  // Computed after mount: depends on window.location (SSR-safe).
  const [bookmarkletHref, setBookmarkletHref] = useState<string | null>(null);

  const [keyDraft, setKeyDraft] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // Load the profile, creating the row (with a capture token) on first visit.
  const bootstrap = useCallback(async () => {
    setLoadError(null);
    try {
      const supabase = createClient();
      const userId = (await supabase.auth.getUser()).data.user!.id;
      const { data, error } = await supabase
        .from("profile")
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      let p = (data as Profile | null) ?? null;

      // Ensure the profile row exists. capture_token is server-issued (the
      // column is not writable by the client), so it is never part of this
      // payload — we mint one with the rotate RPC instead.
      if (!p) {
        const { data: upserted, error: upsertError } = await supabase
          .from("profile")
          .upsert(
            {
              user_id: userId,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" }
          )
          .select("*")
          .maybeSingle();
        if (upsertError) throw new Error(upsertError.message);
        p = (upserted as Profile | null) ?? p;
      }

      if (p && !p.capture_token) {
        const { data: fresh, error: rotateError } = await supabase.rpc(
          "rotate_capture_token"
        );
        if (!rotateError && typeof fresh === "string" && fresh) {
          p = { ...p, capture_token: fresh };
        }
      }

      setProfile(p);
      setKeyDraft(p?.anthropic_api_key ?? "");
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load your profile."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    try {
      setBookmarkletHref(buildBookmarklet(window.location.origin));
    } catch {
      // Leave it null; the card shows a fallback note instead.
    }
  }, []);

  async function saveApiKey() {
    const key = keyDraft.trim();
    if (!key) {
      showToast("Paste your Anthropic API key first.", "error");
      return;
    }
    setSavingKey(true);
    try {
      const supabase = createClient();
      const userId = (await supabase.auth.getUser()).data.user!.id;
      const { error } = await supabase.from("profile").upsert(
        {
          user_id: userId,
          anthropic_api_key: key,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
      if (error) throw new Error(error.message);
      setProfile((prev) =>
        prev ? { ...prev, anthropic_api_key: key } : prev
      );
      showToast("API key saved.", "success");
    } catch (err) {
      showToast(
        `Could not save: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
        "error"
      );
    } finally {
      setSavingKey(false);
    }
  }

  async function goToDashboard() {
    setFinishing(true);
    try {
      const supabase = createClient();
      const userId = (await supabase.auth.getUser()).data.user!.id;
      const { error } = await supabase.from("profile").upsert(
        {
          user_id: userId,
          onboarding_dismissed: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
      if (error) throw new Error(error.message);
    } catch {
      // Even if the flag fails to save, let the user through.
    }
    router.push("/dashboard");
    router.refresh();
  }

  const hasKey = Boolean(profile?.anthropic_api_key);
  const hasCredits = (profile?.credits_cents ?? 0) > 0;
  const aiReady = hasKey || hasCredits;
  const hasResume = Boolean(profile?.master_resume_md?.trim());
  const captureToken = profile?.capture_token ?? null;

  async function copyToken() {
    if (!captureToken) return;
    try {
      await navigator.clipboard.writeText(captureToken);
      showToast("Capture token copied.", "success");
    } catch {
      showToast("Copy failed — your browser blocked clipboard access.", "error");
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            Welcome to StrongerApplicant 👋
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Three quick steps and you&apos;re ready to capture jobs, research
            companies, and generate tailored resumes.
          </p>
        </div>

        {loading ? (
          <LoadingBlock label="Setting things up…" />
        ) : loadError ? (
          <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-6 text-center">
            <p className="text-sm text-red-300">
              Could not load your profile: {loadError}
            </p>
            <button
              onClick={() => {
                setLoading(true);
                void bootstrap();
              }}
              className="mt-3 rounded-lg border border-slate-700 px-4 py-1.5 text-sm text-slate-300 transition hover:bg-slate-800"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Step 1: AI setup — own key (free) or pay-as-you-go credits */}
            <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
              <div className="flex items-start gap-4">
                <StepBadge n={1} done={aiReady} />
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-slate-100">
                    Choose how to power AI features
                  </h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Company research and document generation need one of the
                    two — pick whichever suits you (you can switch anytime).
                  </p>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {/* Option A: bring your own key */}
                    <div
                      className={`rounded-xl border p-4 ${
                        hasKey
                          ? "border-emerald-500/40 bg-emerald-500/5"
                          : "border-slate-700 bg-slate-950/40"
                      }`}
                    >
                      <h3 className="text-sm font-semibold text-slate-100">
                        Free: bring your own key
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-slate-400">
                        Add your Anthropic API key and everything runs for
                        free on your own account. Get one at{" "}
                        <a
                          href="https://console.anthropic.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-400 underline-offset-2 hover:underline"
                        >
                          console.anthropic.com
                        </a>
                        .
                      </p>
                      <div className="mt-3 space-y-2">
                        <div className="flex gap-2">
                          <input
                            type={showKey ? "text" : "password"}
                            autoComplete="off"
                            value={keyDraft}
                            onChange={(e) => setKeyDraft(e.target.value)}
                            placeholder="sk-ant-…"
                            className={inputCls}
                            aria-label="Anthropic API key"
                          />
                          <button
                            type="button"
                            onClick={() => setShowKey((v) => !v)}
                            className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800"
                            aria-pressed={showKey}
                          >
                            {showKey ? "Hide" : "Show"}
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => void saveApiKey()}
                          disabled={savingKey}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
                        >
                          {savingKey && <Spinner className="h-3 w-3" />}
                          Save key
                        </button>
                      </div>
                    </div>

                    {/* Option B: pay-as-you-go credits */}
                    <div
                      className={`rounded-xl border p-4 ${
                        hasCredits
                          ? "border-emerald-500/40 bg-emerald-500/5"
                          : "border-slate-700 bg-slate-950/40"
                      }`}
                    >
                      <h3 className="text-sm font-semibold text-slate-100">
                        Easy: pay-as-you-go credits
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-slate-400">
                        No API key needed — top up a small balance and pay
                        per generation: research{" "}
                        {formatCents(RESEARCH_PRICE_CENTS)}, resume{" "}
                        {formatCents(RESUME_PRICE_CENTS)}, cover letter{" "}
                        {formatCents(COVER_LETTER_PRICE_CENTS)}.
                      </p>
                      {hasCredits && (
                        <p className="mt-2 text-xs font-medium text-emerald-400">
                          Balance: {formatCents(profile?.credits_cents ?? 0)}
                        </p>
                      )}
                      <Link
                        href="/billing"
                        className="mt-3 inline-block rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800"
                      >
                        {hasCredits ? "Manage credits →" : "Buy credits →"}
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Step 2: resume profile */}
            <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
              <div className="flex items-start gap-4">
                <StepBadge n={2} done={hasResume} />
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-slate-100">
                    Fill in your resume profile
                  </h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Add your master resume, contact info, and career highlights
                    on your Profile page — the generator tailors them to every
                    job.
                  </p>
                  <Link
                    href="/profile"
                    className="mt-3 inline-block rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800"
                  >
                    Open Profile →
                  </Link>
                </div>
              </div>
            </section>

            {/* Step 3: adding jobs (link import first, extension second) */}
            <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
              <div className="flex items-start gap-4">
                <StepBadge n={3} done={false} />
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-slate-100">
                    Start adding jobs
                  </h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Nothing to install. Pick whichever way suits you.
                  </p>

                  <div className="mt-3 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
                    <h3 className="text-sm font-semibold text-slate-100">
                      Add jobs by pasting a link
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">
                      The simplest way to start. On the dashboard, click{" "}
                      <span className="font-medium text-slate-300">
                        + Add Application
                      </span>{" "}
                      and paste the job posting URL. We read the posting and
                      fill in the company, title, location, and description for
                      you to review.
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      Works with LinkedIn, Greenhouse, Lever, Ashby, and
                      Workday. A few sites (Indeed, for example) block
                      automated reads, so you may need to paste the description
                      yourself.
                    </p>
                    <Link
                      href="/dashboard"
                      className="mt-3 inline-block rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 transition hover:bg-sky-500/20"
                    >
                      Go to the dashboard →
                    </Link>
                  </div>

                  <h3 className="mt-5 text-sm font-semibold text-slate-100">
                    Or install the Chrome extension
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">
                    Saves a posting in one click from any job board, including
                    sites that block the other methods. Best if you apply in
                    volume.
                  </p>
                  {captureToken && (
                    <div className="mt-3">
                      <p className="mb-1 text-xs font-medium text-slate-400">
                        Your capture token
                      </p>
                      <div className="flex gap-2">
                        <input
                          readOnly
                          value={captureToken}
                          className={`${inputCls} font-mono text-xs`}
                          aria-label="Capture token"
                        />
                        <button
                          type="button"
                          onClick={() => void copyToken()}
                          className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800"
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="mt-3">
                    <ExtensionSteps />
                  </div>

                  {/* De-emphasized third option */}
                  <details className="mt-5 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                    <summary className="cursor-pointer text-xs text-slate-400 transition hover:text-slate-200">
                      Also: quick-capture bookmarklet (works on most boards,
                      not LinkedIn)
                    </summary>
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">
                      Drag this button to your bookmarks bar, then click it on
                      a job posting. LinkedIn blocks bookmarklets, so use link
                      import or the extension there.
                    </p>
                    <div className="mt-2">
                      {bookmarkletHref ? (
                        <a
                          href={bookmarkletHref}
                          draggable
                          onClick={(e) => {
                            e.preventDefault();
                            showToast(
                              "Drag this button to your bookmarks bar instead of clicking it.",
                              "info"
                            );
                          }}
                          className="inline-flex cursor-grab items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-800 active:cursor-grabbing"
                          title="Drag me to your bookmarks bar"
                        >
                          Save to StrongerApplicant
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-500">
                          Preparing the bookmarklet…
                        </span>
                      )}
                    </div>
                  </details>
                </div>
              </div>
            </section>

            <div className="flex items-center justify-center pt-2">
              <button
                onClick={() => void goToDashboard()}
                disabled={finishing}
                className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
              >
                {finishing && <Spinner className="h-4 w-4" />}
                Go to dashboard
              </button>
            </div>
            <p className="text-center text-xs text-slate-500">
              You can change all of this later on the Profile and Settings
              pages.
            </p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
