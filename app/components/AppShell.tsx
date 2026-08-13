"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";

/**
 * Shared chrome for authenticated pages: top navigation bar + content
 * container.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { showToast } = useToast();

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
              J
            </span>
            <span className="hidden text-sm font-semibold tracking-tight text-slate-100 sm:inline">
              JobTracker
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
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
