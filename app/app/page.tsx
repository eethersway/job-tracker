"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { StatusPill } from "@/components/StatusPill";
import {
  COVER_LETTER_PRICE_CENTS,
  RESEARCH_PRICE_CENTS,
  RESUME_PRICE_CENTS,
  formatCents,
} from "@/lib/pricing";
import type { ApplicationStatus } from "@/lib/types";

/**
 * Public marketing landing page for StrongerApplicant. The dashboard lives
 * at /dashboard; signed-in visitors get an "Open dashboard" button.
 */

/** Illustrative pipeline rows for the CSS-only product mock (fictional companies). */
const MOCK_ROWS: {
  company: string;
  role: string;
  status: ApplicationStatus;
}[] = [
  { company: "Northwind Labs", role: "Senior Product Engineer", status: "interviewing" },
  { company: "Lumen Health", role: "Full-Stack Developer", status: "applied" },
  { company: "Orbit Robotics", role: "Platform Engineer", status: "screening" },
  { company: "Brightpath", role: "Frontend Engineer", status: "negotiating" },
  { company: "Acme Cloud", role: "Software Engineer II", status: "ghosted" },
];

function Icon({ path }: { path: string }) {
  return (
    <svg
      className="h-5 w-5 text-sky-400"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path fillRule="evenodd" d={path} clipRule="evenodd" />
    </svg>
  );
}

const FEATURES: { icon: string; title: string; body: string }[] = [
  {
    // bolt
    icon: "M11.983 1.907a.75.75 0 00-1.292-.657l-8.5 9.5A.75.75 0 002.75 12h4.116l-.882 6.093a.75.75 0 001.292.657l8.5-9.5A.75.75 0 0015.25 8h-4.116l.849-6.093z",
    title: "Add jobs in seconds",
    body: "Paste a job link and we read the posting for you, or use the Chrome extension to save it in one click from any job board.",
  },
  {
    // magnifying glass
    icon: "M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z",
    title: "Automatic company research",
    body: "A brief on every company: size, funding, products, and recent news. Ready before you write a word.",
  },
  {
    // document-text
    icon: "M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm2.25 8.5a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5zm0 3a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5z",
    title: "Tailored resumes",
    body: "Your master resume rewritten for each posting. It reorders and sharpens what you did. It never fabricates experience.",
  },
  {
    // light bulb
    icon: "M10 1a6 6 0 00-3.815 10.631C7.237 12.5 8 13.443 8 14.456v.644a.75.75 0 00.572.729 6.016 6.016 0 002.856 0A.75.75 0 0012 15.1v-.644c0-1.013.762-1.957 1.815-2.825A6 6 0 0010 1zM8.863 17.414a.75.75 0 00-.226 1.483 9.066 9.066 0 002.726 0 .75.75 0 00-.226-1.483 7.553 7.553 0 01-2.274 0z",
    title: "Call outs fit check",
    body: "An honest read on how you match the role, gaps included, so you know what to address in the letter and the interview.",
  },
  {
    // arrow-down-tray
    icon: "M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75zM3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z",
    title: "PDF export",
    body: "Print-ready documents with clean typography. Save any resume or cover letter as a PDF straight from the browser.",
  },
  {
    // cpu-chip
    icon: "M14 6H6v8h8V6zM7 2.75a.75.75 0 011.5 0V4h3V2.75a.75.75 0 011.5 0V4h.75A1.75 1.75 0 0115.5 5.75v.75h1.25a.75.75 0 010 1.5H15.5v3h1.25a.75.75 0 010 1.5H15.5v.75a1.75 1.75 0 01-1.75 1.75H13v1.25a.75.75 0 01-1.5 0V16h-3v1.25a.75.75 0 01-1.5 0V16h-.75a1.75 1.75 0 01-1.75-1.75v-.75H3.25a.75.75 0 010-1.5H4.5v-3H3.25a.75.75 0 010-1.5H4.5v-.75A1.75 1.75 0 016.25 4H7V2.75z",
    title: "Connect your AI (MCP)",
    body: "An MCP endpoint for Claude and other clients. Your assistant can read your pipeline, research, and documents, and add applications for you.",
  },
];

const STEPS = [
  {
    n: 1,
    title: "Add the job",
    body: "Paste a link or use the Chrome extension. The posting lands in your tracker with the details filled in.",
  },
  {
    n: 2,
    title: "Research",
    body: "An automatic company brief lands next to the application: size, funding, products, news.",
  },
  {
    n: 3,
    title: "Generate",
    body: "A tailored resume, a matching cover letter, and an honest fit assessment for the role.",
  },
];

export default function LandingPage() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function checkAuth() {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (!cancelled) setSignedIn(Boolean(data.user));
      } catch {
        // Supabase unreachable, treat as signed out.
      }
    }
    void checkAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  const primaryCta =
    "rounded-lg bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/25 transition hover:bg-sky-400";
  const secondaryCta =
    "rounded-lg border border-slate-700 px-5 py-2.5 text-sm text-slate-300 transition hover:border-slate-500 hover:text-slate-100";

  const wordmark = (
    <span className="text-sm font-semibold tracking-tight text-slate-100">
      Stronger<span className="text-sky-400">Applicant</span>
    </span>
  );

  return (
    <div className="relative min-h-screen overflow-x-clip">
      {/* Background glows */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <div className="absolute -top-48 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="absolute right-[-180px] top-[420px] h-[420px] w-[420px] rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="absolute bottom-0 left-[-160px] h-[360px] w-[360px] rounded-full bg-sky-500/5 blur-3xl" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/20 text-sm font-bold text-sky-400">
              S
            </span>
            {wordmark}
          </Link>
          <div className="flex items-center gap-2">
            {signedIn ? (
              <Link
                href="/dashboard"
                className="rounded-lg bg-sky-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-sky-400"
              >
                Open dashboard
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="rounded-lg px-3 py-1.5 text-sm text-slate-400 transition hover:bg-slate-800/60 hover:text-slate-200"
                >
                  Sign in
                </Link>
                <Link
                  href="/signup"
                  className="rounded-lg bg-sky-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-sky-400"
                >
                  Start free
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-16 lg:grid-cols-2 lg:pb-28 lg:pt-24">
          <div>
            <p className="mb-5 inline-block rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300">
              For job seekers running a real pipeline
            </p>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight text-slate-100 sm:text-5xl">
              Every application,{" "}
              <span className="bg-gradient-to-r from-sky-400 to-indigo-400 bg-clip-text text-transparent">
                tailored
              </span>
              . Every company,{" "}
              <span className="bg-gradient-to-r from-sky-400 to-indigo-400 bg-clip-text text-transparent">
                researched
              </span>
              .
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-slate-400">
              StrongerApplicant tracks your pipeline, briefs you on every
              company, and rewrites your resume and cover letter to match the
              posting. Apply stronger, not just more.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {signedIn ? (
                <Link href="/dashboard" className={primaryCta}>
                  Open dashboard
                </Link>
              ) : (
                <>
                  <Link href="/signup" className={primaryCta}>
                    Start free
                  </Link>
                  <Link href="/login" className={secondaryCta}>
                    Sign in
                  </Link>
                </>
              )}
            </div>
            <p className="mt-4 text-xs text-slate-500">
              Tracking is always free. AI features run on your own API key or
              on pay-as-you-go credits.
            </p>
          </div>

          {/* CSS-only product mock */}
          <div aria-hidden="true" className="relative">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 shadow-2xl shadow-slate-950/60 backdrop-blur">
              {/* Window chrome */}
              <div className="flex items-center gap-1.5 border-b border-slate-800 px-4 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
                <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
                <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
                <span className="ml-3 text-xs text-slate-500">
                  Applications
                </span>
              </div>
              {/* Mini table */}
              <div className="p-2 sm:p-3">
                <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 px-2 pb-2 pt-1 text-[10px] font-medium uppercase tracking-wide text-slate-500 sm:grid-cols-[1.1fr_1.3fr_auto]">
                  <span>Company</span>
                  <span className="hidden sm:block">Role</span>
                  <span className="text-right">Status</span>
                </div>
                <div className="space-y-1">
                  {MOCK_ROWS.map((row) => (
                    <div
                      key={row.company}
                      className="grid grid-cols-[1fr_auto] items-center gap-x-3 rounded-lg px-2 py-2 text-xs transition hover:bg-slate-800/40 sm:grid-cols-[1.1fr_1.3fr_auto]"
                    >
                      <span className="truncate font-medium text-slate-200">
                        {row.company}
                      </span>
                      <span className="hidden truncate text-slate-400 sm:block">
                        {row.role}
                      </span>
                      <span className="justify-self-end">
                        <StatusPill status={row.status} />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* Floating research card */}
            <div className="absolute -bottom-6 -left-3 hidden w-56 rounded-2xl border border-slate-800 bg-slate-950/90 p-4 shadow-xl shadow-slate-950/60 backdrop-blur sm:block">
              <p className="text-[10px] font-medium uppercase tracking-wide text-sky-400">
                Company brief ready
              </p>
              <div className="mt-2 space-y-1.5">
                <div className="h-1.5 w-full rounded bg-slate-800" />
                <div className="h-1.5 w-4/5 rounded bg-slate-800" />
                <div className="h-1.5 w-3/5 rounded bg-slate-800" />
              </div>
              <p className="mt-3 text-[11px] text-slate-400">
                Size, funding, products, news
              </p>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="border-y border-slate-800 bg-slate-900/30">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
            <h2 className="text-center text-2xl font-semibold tracking-tight text-slate-100">
              Three steps per application
            </h2>
            <p className="mx-auto mt-2 max-w-md text-center text-sm text-slate-400">
              Minutes of work instead of an evening. The quality goes up, not
              down.
            </p>
            <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
              {STEPS.map((s) => (
                <div
                  key={s.n}
                  className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-center transition hover:-translate-y-0.5 hover:border-slate-700"
                >
                  <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-sky-500/40 bg-sky-500/10 text-sm font-semibold text-sky-300">
                    {s.n}
                  </span>
                  <h3 className="mt-4 text-sm font-semibold text-slate-100">
                    {s.title}
                  </h3>
                  <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-slate-400">
                    {s.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Feature grid */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
          <h2 className="text-center text-2xl font-semibold tracking-tight text-slate-100">
            Built for the whole application, not just the tracking
          </h2>
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 transition hover:-translate-y-0.5 hover:border-slate-700"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10">
                  <Icon path={f.icon} />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-slate-100">
                  {f.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section className="border-t border-slate-800 bg-slate-900/30">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
            <h2 className="text-center text-2xl font-semibold tracking-tight text-slate-100">
              Honest pricing, two ways
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-center text-sm text-slate-400">
              Tracking is always free. AI research and generation run on your
              own key or on credits. No subscription either way.
            </p>
            <div className="mx-auto mt-10 grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 transition hover:-translate-y-0.5 hover:border-slate-700">
                <h3 className="text-sm font-semibold text-slate-100">
                  Free with your own Anthropic API key
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  Bring your own key and every research run and generation is
                  free. The key stays in your account and is used only for
                  your own requests.
                </p>
              </div>
              <div className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-6 transition hover:-translate-y-0.5 hover:border-sky-500/50">
                <h3 className="text-sm font-semibold text-slate-100">
                  Pay as you go
                </h3>
                <ul className="mt-3 space-y-2 text-sm text-slate-300">
                  <li className="flex justify-between gap-4">
                    <span>Company research</span>
                    <span className="font-medium text-sky-300">
                      {formatCents(RESEARCH_PRICE_CENTS)}
                    </span>
                  </li>
                  <li className="flex justify-between gap-4">
                    <span>Resume + fit assessment</span>
                    <span className="font-medium text-sky-300">
                      {formatCents(RESUME_PRICE_CENTS)}
                    </span>
                  </li>
                  <li className="flex justify-between gap-4">
                    <span>Cover letter</span>
                    <span className="font-medium text-sky-300">
                      {formatCents(COVER_LETTER_PRICE_CENTS)}
                    </span>
                  </li>
                </ul>
                <p className="mt-3 text-xs text-slate-400">
                  Top up with $5 or $10 credit packs. Credits never expire. No
                  subscription.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="border-t border-slate-800">
          <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:py-20">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-100">
              Your next application can be your strongest
            </h2>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              {signedIn ? (
                <Link href="/dashboard" className={primaryCta}>
                  Open dashboard
                </Link>
              ) : (
                <>
                  <Link href="/signup" className={primaryCta}>
                    Start free
                  </Link>
                  <Link href="/login" className={secondaryCta}>
                    Sign in
                  </Link>
                </>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-800">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-slate-500">
          <span>
            Stronger<span className="text-sky-500">Applicant</span>
          </span>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/eethersway/job-tracker"
              target="_blank"
              rel="noopener noreferrer"
              className="transition hover:text-slate-300"
            >
              GitHub
            </a>
            <span>Built with Next.js + Supabase</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
