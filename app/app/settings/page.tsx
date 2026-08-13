"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/AppShell";
import { LoadingBlock, Spinner } from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { ExtensionSteps } from "@/components/ExtensionSteps";
import { formatDateTime } from "@/lib/format";
import { generateCaptureToken } from "@/lib/token";
import type { Profile } from "@/lib/types";

const inputCls =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none transition focus:border-sky-500";
const labelCls = "mb-1 block text-xs font-medium text-slate-400";
const textareaCls =
  "w-full resize-y rounded-lg border border-slate-700 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-200 placeholder-slate-600 outline-none focus:border-sky-500";

export default function SettingsPage() {
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  // Contact info (always included in generated resumes)
  const [fullName, setFullName] = useState("");
  const [locationVal, setLocationVal] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [website, setWebsite] = useState("");

  // Content sections
  const [masterResume, setMasterResume] = useState("");
  const [highlights, setHighlights] = useState("");
  const [skills, setSkills] = useState("");
  const [extraContext, setExtraContext] = useState("");

  // AI & extension
  const [anthropicKey, setAnthropicKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [captureToken, setCaptureToken] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const fetchProfile = useCallback(async () => {
    setLoadError(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("profile")
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      const p = (data as Profile | null) ?? null;
      setProfile(p);
      setFullName(p?.full_name ?? "");
      setLocationVal(p?.location ?? "");
      setPhone(p?.phone ?? "");
      setEmail(p?.email ?? "");
      setLinkedinUrl(p?.linkedin_url ?? "");
      setWebsite(p?.website ?? "");
      setMasterResume(p?.master_resume_md ?? "");
      setHighlights(p?.highlights_md ?? "");
      setSkills(p?.skills_md ?? "");
      setExtraContext(p?.extra_context_md ?? "");
      setAnthropicKey(p?.anthropic_api_key ?? "");
      setCaptureToken(p?.capture_token ?? null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load profile."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  async function handleSave() {
    setSaving(true);
    try {
      const supabase = createClient();
      const userId = (await supabase.auth.getUser()).data.user!.id;
      const now = new Date().toISOString();
      // Auto-generate a capture token on first save if none exists yet.
      const token = captureToken ?? generateCaptureToken();
      const row = {
        user_id: userId,
        full_name: fullName.trim() || null,
        location: locationVal.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        linkedin_url: linkedinUrl.trim() || null,
        website: website.trim() || null,
        master_resume_md: masterResume || null,
        highlights_md: highlights || null,
        skills_md: skills || null,
        extra_context_md: extraContext || null,
        anthropic_api_key: anthropicKey.trim() || null,
        capture_token: token,
        updated_at: now,
      };
      const { error } = await supabase
        .from("profile")
        .upsert(row, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
      setCaptureToken(token);
      setProfile((prev) => ({
        onboarding_dismissed: prev?.onboarding_dismissed ?? false,
        credits_cents: prev?.credits_cents ?? 0,
        ...prev,
        ...row,
      }));
      setDirty(false);
      showToast("Profile saved.", "success");
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

  async function copyCaptureToken() {
    if (!captureToken) return;
    try {
      await navigator.clipboard.writeText(captureToken);
      showToast("Capture token copied.", "success");
    } catch {
      showToast("Copy failed — your browser blocked clipboard access.", "error");
    }
  }

  async function regenerateCaptureToken() {
    setRegenerating(true);
    try {
      const supabase = createClient();
      const userId = (await supabase.auth.getUser()).data.user!.id;
      const token = generateCaptureToken();
      const { error } = await supabase.from("profile").upsert(
        {
          user_id: userId,
          capture_token: token,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
      if (error) throw new Error(error.message);
      setCaptureToken(token);
      showToast(
        "New capture token saved — update it in the extension Options too.",
        "success"
      );
    } catch (err) {
      showToast(
        `Could not regenerate token: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
        "error"
      );
    } finally {
      setRegenerating(false);
    }
  }

  const mark =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setDirty(true);
    };

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-slate-100">
          Settings
        </h1>
        <div className="flex items-center gap-3">
          {profile?.updated_at && !dirty && (
            <span className="text-xs text-slate-500">
              Last saved {formatDateTime(profile.updated_at)}
            </span>
          )}
          {dirty && (
            <span className="text-xs text-amber-400">Unsaved changes</span>
          )}
          <button
            onClick={() => void handleSave()}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
          >
            {saving && <Spinner className="h-3.5 w-3.5" />}
            Save
          </button>
        </div>
      </div>

      {loading ? (
        <LoadingBlock label="Loading settings…" />
      ) : loadError ? (
        <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-6 text-center">
          <p className="text-sm text-red-300">
            Could not load your profile: {loadError}
          </p>
          <button
            onClick={() => {
              setLoading(true);
              void fetchProfile();
            }}
            className="mt-3 rounded-lg border border-slate-700 px-4 py-1.5 text-sm text-slate-300 transition hover:bg-slate-800"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {/* AI & extension */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-base font-semibold text-slate-100">
              AI &amp; Extension
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Your API key powers company research and document generation; the
              capture token lets the Chrome extension save jobs into your
              account.
            </p>

            <div className="mt-4 space-y-5">
              <div className="max-w-xl">
                <label htmlFor="anthropic-key" className={labelCls}>
                  Anthropic API key
                </label>
                <div className="flex gap-2">
                  <input
                    id="anthropic-key"
                    type={showKey ? "text" : "password"}
                    autoComplete="off"
                    value={anthropicKey}
                    onChange={(e) => mark(setAnthropicKey)(e.target.value)}
                    placeholder="sk-ant-…"
                    className={inputCls}
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
                <p className="mt-1.5 text-xs text-slate-500">
                  Optional — with a key, all generation is free. Without one,
                  generations use your credit balance (see{" "}
                  <Link
                    href="/billing"
                    className="text-sky-400 underline-offset-2 hover:underline"
                  >
                    Billing
                  </Link>
                  ). Get a key at{" "}
                  <a
                    href="https://console.anthropic.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-400 underline-offset-2 hover:underline"
                  >
                    console.anthropic.com
                  </a>
                  — it is stored in your account and used only for your own
                  research and generation.
                </p>
              </div>

              <div className="max-w-xl">
                <label htmlFor="capture-token" className={labelCls}>
                  Capture token
                </label>
                <div className="flex gap-2">
                  <input
                    id="capture-token"
                    readOnly
                    value={captureToken ?? ""}
                    placeholder="Generated on first save"
                    className={`${inputCls} font-mono text-xs`}
                  />
                  <button
                    type="button"
                    onClick={() => void copyCaptureToken()}
                    disabled={!captureToken}
                    className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => void regenerateCaptureToken()}
                    disabled={regenerating}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    {regenerating && <Spinner className="h-3 w-3" />}
                    Regenerate
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  The Chrome extension sends this token with every captured job
                  so it lands in your account.
                </p>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium text-slate-200">
                  Install the Chrome extension
                </h3>
                <ExtensionSteps />
              </div>
            </div>
          </section>

          {/* Contact info */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-base font-semibold text-slate-100">
              Contact Info
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Included in the header of every generated resume: name, location,
              phone, and LinkedIn are always shown.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label htmlFor="full-name" className={labelCls}>
                  Full name *
                </label>
                <input
                  id="full-name"
                  value={fullName}
                  onChange={(e) => mark(setFullName)(e.target.value)}
                  placeholder="Jane Doe"
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="location" className={labelCls}>
                  Location *
                </label>
                <input
                  id="location"
                  value={locationVal}
                  onChange={(e) => mark(setLocationVal)(e.target.value)}
                  placeholder="Seattle, WA"
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="phone" className={labelCls}>
                  Phone *
                </label>
                <input
                  id="phone"
                  value={phone}
                  onChange={(e) => mark(setPhone)(e.target.value)}
                  placeholder="(555) 555-5555"
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="linkedin" className={labelCls}>
                  LinkedIn URL *
                </label>
                <input
                  id="linkedin"
                  value={linkedinUrl}
                  onChange={(e) => mark(setLinkedinUrl)(e.target.value)}
                  placeholder="https://linkedin.com/in/janedoe"
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="email" className={labelCls}>
                  Email
                </label>
                <input
                  id="email"
                  value={email}
                  onChange={(e) => mark(setEmail)(e.target.value)}
                  placeholder="jane@example.com"
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="website" className={labelCls}>
                  Website / portfolio
                </label>
                <input
                  id="website"
                  value={website}
                  onChange={(e) => mark(setWebsite)(e.target.value)}
                  placeholder="https://janedoe.com"
                  className={inputCls}
                />
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              * always included in generated resumes
            </p>
          </section>

          {/* Master resume editor */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-base font-semibold text-slate-100">
              Master Resume
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Your complete resume in Markdown — every role, dates, and what
              you did. It doesn&apos;t need to be polished: the sections below
              let you add the good material (numbers, wins, skills) separately,
              and the generator combines everything.
            </p>
            <textarea
              id="master-resume"
              value={masterResume}
              onChange={(e) => mark(setMasterResume)(e.target.value)}
              placeholder={
                "## Experience\n\n### Account Executive — Acme Corp (2021–present)\n- Owned full sales cycle for mid-market accounts…\n\n### SDR — Beta Inc (2019–2021)\n- …\n\n## Education\n…"
              }
              className={`${textareaCls} mt-4 min-h-[400px]`}
            />
          </section>

          {/* Career highlights */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-base font-semibold text-slate-100">
              Career Highlights &amp; Numbers
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Achievements with concrete numbers, even rough ones: quota
              attainment, revenue closed, deals won, pipeline generated, teams
              led, rankings. The generator leans on these to make every bullet
              achievement-focused — list things here even if they&apos;re not in
              the resume above.
            </p>
            <textarea
              value={highlights}
              onChange={(e) => mark(setHighlights)(e.target.value)}
              placeholder={
                "- 137% of quota FY2025 ($1.4M closed against $1.02M target)\n- #2 AE of 14 two quarters running\n- Sourced 60% of own pipeline; avg deal size $85K\n- Landed 3 logos >1,000 employees, incl. first Fortune 500 customer"
              }
              className={`${textareaCls} mt-4 min-h-[160px]`}
            />
          </section>

          {/* Skills & tools */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-base font-semibold text-slate-100">
              Skills &amp; Tools
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Software, methodologies, certifications, languages. Per your
              rules, a Skills &amp; Tools section is only included in the
              generated resume when the job is technical — but keeping the list
              current helps tailoring either way.
            </p>
            <textarea
              value={skills}
              onChange={(e) => mark(setSkills)(e.target.value)}
              placeholder={
                "Salesforce, HubSpot, Outreach, Gong, LinkedIn Sales Navigator, SQL (basic), MEDDIC, Challenger"
              }
              className={`${textareaCls} mt-4 min-h-[100px]`}
            />
          </section>

          {/* Extra context */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-base font-semibold text-slate-100">
              Extra Context
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Anything else the generator should know: preferences (tone,
              length), industries you know well, visa/work authorization,
              stories behind career moves, things to avoid mentioning.
            </p>
            <textarea
              value={extraContext}
              onChange={(e) => mark(setExtraContext)(e.target.value)}
              placeholder={
                "Prefer concise one-page resumes. Deep fintech and crypto network. Don't highlight the 2019 gap — covered by consulting work."
              }
              className={`${textareaCls} mt-4 min-h-[120px]`}
            />
          </section>
        </div>
      )}
    </AppShell>
  );
}
