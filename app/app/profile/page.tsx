"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/AppShell";
import { LoadingBlock, Spinner } from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { formatDateTime } from "@/lib/format";
import type { Profile } from "@/lib/types";

const inputCls =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none transition focus:border-sky-500";
const labelCls = "mb-1 block text-xs font-medium text-slate-400";
const textareaCls =
  "w-full resize-y rounded-lg border border-slate-700 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-200 placeholder-slate-600 outline-none focus:border-sky-500";

/**
 * Resume profile: contact info + master resume + supporting content used by
 * document generation. The upsert here deliberately includes ONLY the fields
 * this page owns, so it can never clobber the AI/extension fields managed on
 * the Settings page (anthropic_api_key, capture_token).
 */
export default function ProfilePage() {
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
      // Only the fields this page owns — never anthropic_api_key or
      // capture_token (those belong to Settings).
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
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("profile")
        .upsert(row, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
      setProfile((prev) => (prev ? { ...prev, ...row } : prev));
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
          Profile
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
        <LoadingBlock label="Loading profile…" />
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
