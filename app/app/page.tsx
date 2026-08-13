"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  COVER_LETTER_PRICE_CENTS,
  RESEARCH_PRICE_CENTS,
  RESUME_PRICE_CENTS,
  formatCents,
} from "@/lib/pricing";

/**
 * Public marketing landing page. The dashboard now lives at /dashboard;
 * signed-in visitors get an "Open dashboard" button instead of Log in.
 */

const FEATURES = [
  {
    icon: "📋",
    title: "Application tracker",
    body: "Every application in one place — status, notes, job description, salary, and dates. Filter, search, and never lose track of a lead again.",
  },
  {
    icon: "🔍",
    title: "Automatic company research",
    body: "One click and AI gathers a company brief: size, funding, products, and recent news — ready before your interview prep even starts.",
  },
  {
    icon: "📝",
    title: "Tailored resumes & cover letters",
    body: "Generation rewrites your master resume for each job description and drafts a matching cover letter, with a fit assessment on top.",
  },
  {
    icon: "⚡",
    title: "One-click capture",
    body: "The Chrome extension grabs job postings straight from any job board into your tracker — title, company, description, and URL.",
  },
];

const STEPS = [
  {
    n: 1,
    title: "Capture a job",
    body: "Save postings with the Chrome extension or add them by hand.",
  },
  {
    n: 2,
    title: "Research & generate",
    body: "Run AI company research, then generate a tailored resume and cover letter.",
  },
  {
    n: 3,
    title: "Apply & track",
    body: "Send it off and track every stage from applied to offer.",
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
        // Supabase unreachable — treat as signed out.
      }
    }
    void checkAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  const primaryCta =
    "rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-500";
  const secondaryCta =
    "rounded-lg border border-slate-700 px-5 py-2.5 text-sm text-slate-300 transition hover:bg-slate-800";

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/20 text-sm font-bold text-sky-400">
              J
            </span>
            <span className="text-sm font-semibold tracking-tight text-slate-100">
              JobTracker
            </span>
          </Link>
          <div className="flex items-center gap-2">
            {signedIn ? (
              <Link
                href="/dashboard"
                className="rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-sky-500"
              >
                Open dashboard
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="rounded-lg px-3 py-1.5 text-sm text-slate-400 transition hover:bg-slate-800/60 hover:text-slate-200"
                >
                  Log in
                </Link>
                <Link
                  href="/signup"
                  className="rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-sky-500"
                >
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-16 text-center sm:pb-24 sm:pt-24">
          <p className="mx-auto mb-4 inline-block rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300">
            Tracker + AI research + tailored documents
          </p>
          <h1 className="mx-auto max-w-3xl text-3xl font-semibold tracking-tight text-slate-100 sm:text-5xl">
            Your AI-powered job search HQ
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-slate-400 sm:text-base">
            Capture postings in one click, keep every application organized,
            and let AI research each company and tailor your resume and cover
            letter to the job — so you spend your time interviewing, not
            copy-pasting.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {signedIn ? (
              <Link href="/dashboard" className={primaryCta}>
                Open dashboard
              </Link>
            ) : (
              <>
                <Link href="/signup" className={primaryCta}>
                  Get started — it&apos;s free
                </Link>
                <Link href="/login" className={secondaryCta}>
                  Log in
                </Link>
              </>
            )}
          </div>
        </section>

        {/* Feature cards */}
        <section className="mx-auto max-w-6xl px-4 pb-16 sm:pb-24">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"
              >
                <p className="text-2xl" aria-hidden="true">
                  {f.icon}
                </p>
                <h2 className="mt-3 text-sm font-semibold text-slate-100">
                  {f.title}
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="border-y border-slate-800 bg-slate-900/30">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:py-16">
            <h2 className="text-center text-xl font-semibold tracking-tight text-slate-100">
              How it works
            </h2>
            <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
              {STEPS.map((s) => (
                <div key={s.n} className="text-center">
                  <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-full border border-sky-500/40 bg-sky-500/10 text-sm font-semibold text-sky-300">
                    {s.n}
                  </span>
                  <h3 className="mt-3 text-sm font-semibold text-slate-100">
                    {s.title}
                  </h3>
                  <p className="mx-auto mt-1 max-w-xs text-sm text-slate-400">
                    {s.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
          <h2 className="text-center text-xl font-semibold tracking-tight text-slate-100">
            Simple pricing
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-sm text-slate-400">
            Tracking is always free. AI features run on your own key or on
            pay-as-you-go credits — no subscription either way.
          </p>
          <div className="mx-auto mt-8 grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
              <h3 className="text-sm font-semibold text-slate-100">
                Free — bring your own key
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                Add your Anthropic API key and all research and generation is
                free. Your key is stored in your account and used only for
                your own requests.
              </p>
            </div>
            <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-6">
              <h3 className="text-sm font-semibold text-slate-100">
                Pay-as-you-go credits
              </h3>
              <p className="mt-2 text-sm text-slate-400">
                No key needed. Top up once, pay per generation:
              </p>
              <ul className="mt-3 space-y-1.5 text-sm text-slate-300">
                <li className="flex justify-between gap-4">
                  <span>Company research</span>
                  <span className="font-medium text-sky-300">
                    {formatCents(RESEARCH_PRICE_CENTS)}
                  </span>
                </li>
                <li className="flex justify-between gap-4">
                  <span>Tailored resume</span>
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
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="border-t border-slate-800 bg-slate-900/30">
          <div className="mx-auto max-w-6xl px-4 py-14 text-center sm:py-16">
            <h2 className="text-xl font-semibold tracking-tight text-slate-100">
              Ready to run a smarter job search?
            </h2>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              {signedIn ? (
                <Link href="/dashboard" className={primaryCta}>
                  Open dashboard
                </Link>
              ) : (
                <>
                  <Link href="/signup" className={primaryCta}>
                    Create your account
                  </Link>
                  <Link href="/login" className={secondaryCta}>
                    Log in
                  </Link>
                </>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-800">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-slate-500">
          <span>JobTracker — your job search HQ</span>
          <span>Built with Next.js &amp; Supabase</span>
        </div>
      </footer>
    </div>
  );
}
