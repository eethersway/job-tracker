"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/Spinner";
import { useToast } from "@/components/Toast";

type PageState = "verifying" | "ready" | "invalid";

/**
 * Password recovery landing page (public). The reset email links here —
 * either with a ?code= param (PKCE flow, exchanged for a session below) or
 * with tokens in the URL hash (implicit flow, picked up automatically by
 * supabase-js). Once a session exists the user can set a new password.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [pageState, setPageState] = useState<PageState>("verifying");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function establishSession() {
      try {
        const supabase = createClient();

        // PKCE flow: exchange the ?code= from the email link for a session.
        const code = new URLSearchParams(window.location.search).get("code");
        if (code) {
          try {
            const { error: exchangeError } =
              await supabase.auth.exchangeCodeForSession(code);
            if (!exchangeError) {
              if (!cancelled) setPageState("ready");
              return;
            }
          } catch {
            // Fall through to the session check below.
          }
        }

        // Implicit flow (hash tokens, auto-detected by supabase-js) or an
        // already-signed-in user changing their password via this page.
        const { data } = await supabase.auth.getSession();
        if (!cancelled) setPageState(data.session ? "ready" : "invalid");
      } catch {
        if (!cancelled) setPageState("invalid");
      }
    }
    void establishSession();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      showToast("Password updated.", "success");
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Could not update your password. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none transition focus:border-sky-500";
  const labelCls = "mb-1 block text-xs font-medium text-slate-400";

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
            <p className="mt-1 text-sm text-slate-400">Set a new password</p>
          </div>
        </div>

        {pageState === "verifying" ? (
          <div className="flex items-center justify-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-slate-400 shadow-xl">
            <Spinner className="h-4 w-4" />
            <span className="text-sm">Verifying reset link…</span>
          </div>
        ) : pageState === "invalid" ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-center shadow-xl">
            <p className="text-2xl">⚠️</p>
            <h2 className="mt-3 text-base font-semibold text-slate-100">
              This reset link is invalid or expired
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Request a new reset link from the sign-in page and try again.
            </p>
            <Link
              href="/login"
              className="mt-5 inline-block rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500"
            >
              Go to sign in
            </Link>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl"
          >
            <div className="space-y-4">
              <div>
                <label htmlFor="new-password" className={labelCls}>
                  New password
                </label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputCls}
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label htmlFor="confirm-password" className={labelCls}>
                  Confirm new password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className={inputCls}
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
                disabled={saving}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
              >
                {saving && <Spinner className="h-4 w-4" />}
                {saving ? "Updating…" : "Update password"}
              </button>
            </div>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-slate-500">
          Remembered it after all?{" "}
          <Link
            href="/login"
            className="text-sky-400 underline-offset-2 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
