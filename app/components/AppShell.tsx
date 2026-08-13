"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import type { Profile } from "@/lib/types";

/**
 * Shared chrome for authenticated pages: top navigation bar + content
 * container, plus the account-suspended banner.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { showToast } = useToast();

  const [suspended, setSuspended] = useState(false);
  const [suspendedReason, setSuspendedReason] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function checkSuspension() {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("profile")
          .select("suspended, suspended_reason")
          .maybeSingle();
        if (error) return;
        const p =
          (data as Pick<Profile, "suspended" | "suspended_reason"> | null) ??
          null;
        if (!cancelled && p?.suspended) {
          setSuspended(true);
          setSuspendedReason(p.suspended_reason ?? null);
        }
      } catch {
        // Never block the app chrome on this check.
      }
    }
    void checkSuspension();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  async function handleSignOut() {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // Even if the network call fails, send the user to the login page.
      showToast("Sign-out request failed — redirecting to login.", "error");
    }
    router.push("/login");
    router.refresh();
  }

  const navLink = (href: string, label: string) => {
    const active = pathname.startsWith(href);
    return (
      <Link
        href={href}
        className={`rounded-lg px-2 py-1.5 text-sm transition sm:px-3 ${
          active
            ? "bg-slate-800 text-slate-100"
            : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:gap-6">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/20 text-sm font-bold text-sky-400">
              S
            </span>
            <span className="hidden text-sm font-semibold tracking-tight text-slate-100 sm:inline">
              Stronger<span className="text-sky-400">Applicant</span>
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            {navLink("/dashboard", "Dashboard")}
            {navLink("/profile", "Profile")}
            {navLink("/settings", "Settings")}
            {navLink("/billing", "Billing")}
          </nav>
          <div className="ml-auto">
            <button
              onClick={handleSignOut}
              className="rounded-lg px-2 py-1.5 text-sm text-slate-400 transition hover:bg-slate-800/60 hover:text-slate-200 sm:px-3"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      {suspended && (
        <div
          role="alert"
          className="border-b border-amber-500/40 bg-amber-950/60"
        >
          <div className="mx-auto flex max-w-6xl items-start gap-3 px-4 py-3">
            <svg
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-400"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                clipRule="evenodd"
              />
            </svg>
            <p className="text-sm text-amber-100">
              Your account is on hold because a payment was reversed. Contact
              support to restore it.
              {suspendedReason ? (
                <span className="mt-0.5 block text-xs text-amber-200/70">
                  {suspendedReason}
                </span>
              ) : null}
            </p>
          </div>
        </div>
      )}
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
