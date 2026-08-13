"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/Spinner";
import { isSupabaseConfigured } from "@/lib/env";

type View = "login" | "forgot" | "reset_sent";

export default function LoginPage() {
  const router = useRouter();
  const [view, setView] = useState<View>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Please enter both your email and password.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(
          signInError.message === "Invalid login credentials"
            ? "Invalid email or password."
            : signInError.message
        );
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError(
        isSupabaseConfigured()
          ? "Could not reach the server. Check your connection and try again."
          : "Supabase is not configured yet — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleResetRequest(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }

    setSendingReset(true);
    try {
      const supabase = createClient();
      await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
    } catch {
      // Deliberately swallowed — always show success so the form can't be
      // used to probe which emails have accounts (no account enumeration).
    } finally {
      setSendingReset(false);
      setView("reset_sent");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky-500/20 text-xl font-bold text-sky-400">
            S
          </span>
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">
              Stronger<span className="text-sky-400">Applicant</span>
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Sign in to your job application tracker
            </p>
          </div>
        </div>

        {view === "reset_sent" ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-center shadow-xl">
            <p className="text-2xl">📬</p>
            <h2 className="mt-3 text-base font-semibold text-slate-100">
              Check your email for a reset link
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              If an account exists for{" "}
              <span className="font-medium text-slate-200">{email.trim()}</span>
              , a password reset link is on its way.
            </p>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setView("login");
              }}
              className="mt-5 inline-block rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500"
            >
              Back to sign in
            </button>
          </div>
        ) : view === "forgot" ? (
          <form
            onSubmit={handleResetRequest}
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl"
          >
            <div className="space-y-4">
              <p className="text-sm text-slate-400">
                Enter your account email and we&apos;ll send you a link to
                reset your password.
              </p>
              <div>
                <label
                  htmlFor="email"
                  className="mb-1 block text-xs font-medium text-slate-400"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none transition focus:border-sky-500"
                  placeholder="you@example.com"
                />
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-500/30 bg-red-950/40 px-3 py-2 text-sm text-red-300"
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={sendingReset}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
              >
                {sendingReset && <Spinner className="h-4 w-4" />}
                {sendingReset ? "Sending…" : "Send reset link"}
              </button>

              <p className="text-center text-xs text-slate-500">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setView("login");
                  }}
                  className="text-sky-400 underline-offset-2 hover:underline"
                >
                  Back to sign in
                </button>
              </p>
            </div>
          </form>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl"
          >
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="mb-1 block text-xs font-medium text-slate-400"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none transition focus:border-sky-500"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label
                  htmlFor="password"
                  className="mb-1 block text-xs font-medium text-slate-400"
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none transition focus:border-sky-500"
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-500/30 bg-red-950/40 px-3 py-2 text-sm text-red-300"
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
              >
                {loading && <Spinner className="h-4 w-4" />}
                {loading ? "Signing in…" : "Sign in"}
              </button>

              <p className="text-center text-xs text-slate-500">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setView("forgot");
                  }}
                  className="text-sky-400 underline-offset-2 hover:underline"
                >
                  Forgot password?
                </button>
              </p>
            </div>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-slate-500">
          No account yet?{" "}
          <Link
            href="/signup"
            className="text-sky-400 underline-offset-2 hover:underline"
          >
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
