"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/AppShell";
import { LoadingBlock, Spinner } from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { ExtensionSteps, FUNCTIONS_BASE_URL } from "@/components/ExtensionSteps";
import { buildBookmarklet } from "@/lib/extract-page";
import { formatDateTime } from "@/lib/format";
import type { Profile } from "@/lib/types";

const inputCls =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none transition focus:border-sky-500";
const labelCls = "mb-1 block text-xs font-medium text-slate-400";

/** HTTP endpoint of the MCP edge function (read-only, shown for LLM clients). */
const MCP_ENDPOINT_URL = `${FUNCTIONS_BASE_URL}/mcp`;

/**
 * Settings: AI & extension configuration only (API key + capture token +
 * extension install). Resume content lives on the Profile page. The upsert
 * here deliberately includes ONLY the fields this page owns, so it can never
 * clobber the resume fields managed on /profile.
 */
export default function SettingsPage() {
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const [anthropicKey, setAnthropicKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [captureToken, setCaptureToken] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [apiToken, setApiToken] = useState<string | null>(null);
  const [regeneratingApiToken, setRegeneratingApiToken] = useState(false);

  // Bookmarklet href depends on window.location, so it is computed after
  // mount to avoid an SSR/client hydration mismatch.
  const [bookmarkletHref, setBookmarkletHref] = useState<string | null>(null);

  // Account (password change) — independent of the page's main Save.
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [updatingPassword, setUpdatingPassword] = useState(false);

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
      setAnthropicKey(p?.anthropic_api_key ?? "");
      setCaptureToken(p?.capture_token ?? null);
      setApiToken(p?.api_token ?? null);
      try {
        const { data: userData } = await supabase.auth.getUser();
        setAccountEmail(userData.user?.email ?? null);
      } catch {
        // Email is display-only context — missing it shouldn't fail the page.
      }
      // Tokens are server-issued now: mint any that are still missing via
      // the rotate RPCs (the columns are not writable by the client).
      if (p && !p.capture_token) {
        const { data: fresh } = await supabase.rpc("rotate_capture_token");
        if (typeof fresh === "string" && fresh) setCaptureToken(fresh);
      }
      if (p && !p.api_token) {
        const { data: fresh } = await supabase.rpc("rotate_api_token");
        if (typeof fresh === "string" && fresh) setApiToken(fresh);
      }
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load settings."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    try {
      setBookmarkletHref(buildBookmarklet(window.location.origin));
    } catch {
      // Leave it null; the card shows a fallback note instead.
    }
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const supabase = createClient();
      const userId = (await supabase.auth.getUser()).data.user!.id;
      // capture_token and api_token are NOT writable by the client any more
      // (server-issued via the rotate RPCs), so they must stay out of this
      // payload or the upsert is rejected. Resume/contact content belongs to
      // the Profile page, so it stays out too.
      const row = {
        user_id: userId,
        anthropic_api_key: anthropicKey.trim() || null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("profile")
        .upsert(row, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
      setProfile((prev) => (prev ? { ...prev, ...row } : prev));

      // Mint tokens server-side if this profile still has none.
      if (!captureToken) {
        const { data: fresh } = await supabase.rpc("rotate_capture_token");
        if (typeof fresh === "string" && fresh) setCaptureToken(fresh);
      }
      if (!apiToken) {
        const { data: fresh } = await supabase.rpc("rotate_api_token");
        if (typeof fresh === "string" && fresh) setApiToken(fresh);
      }
      setDirty(false);
      showToast("Settings saved.", "success");
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
      // Server-issued: the column is not writable by the client.
      const { data, error } = await supabase.rpc("rotate_capture_token");
      if (error) throw new Error(error.message);
      const token = typeof data === "string" ? data : "";
      if (!token) throw new Error("The server did not return a new token.");
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

  async function copyText(value: string | null, what: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      showToast(`${what} copied.`, "success");
    } catch {
      showToast("Copy failed — your browser blocked clipboard access.", "error");
    }
  }

  async function regenerateApiToken() {
    setRegeneratingApiToken(true);
    try {
      const supabase = createClient();
      // Server-issued: the column is not writable by the client.
      const { data, error } = await supabase.rpc("rotate_api_token");
      if (error) throw new Error(error.message);
      const token = typeof data === "string" ? data : "";
      if (!token) throw new Error("The server did not return a new token.");
      setApiToken(token);
      showToast(
        "New API token saved — update it in any connected LLM clients too.",
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
      setRegeneratingApiToken(false);
    }
  }

  async function updatePassword() {
    setPasswordError(null);
    if (!currentPassword) {
      setPasswordError("Enter your current password.");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }
    if (!accountEmail) {
      setPasswordError(
        "Could not confirm which account you are signed in as. Reload and try again."
      );
      return;
    }
    setUpdatingPassword(true);
    try {
      const supabase = createClient();
      // Re-authenticate first so a hijacked session cannot silently change
      // the password and lock the real owner out.
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: accountEmail,
        password: currentPassword,
      });
      if (reauthError) {
        setPasswordError("Current password is incorrect.");
        return;
      }
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) throw new Error(error.message);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      showToast("Password updated.", "success");
    } catch (err) {
      showToast(
        `Could not update password: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
        "error"
      );
    } finally {
      setUpdatingPassword(false);
    }
  }

  const mcpAddCommand = `claude mcp add strongerapplicant --transport http ${MCP_ENDPOINT_URL} --header "Authorization: Bearer ${
    apiToken ?? "<token>"
  }"`;

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
            Could not load your settings: {loadError}
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
              account. Looking for your resume content? That&apos;s on the{" "}
              <Link
                href="/profile"
                className="text-sky-400 underline-offset-2 hover:underline"
              >
                Profile
              </Link>{" "}
              page.
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
                    onChange={(e) => {
                      setAnthropicKey(e.target.value);
                      setDirty(true);
                    }}
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

          {/* Quick capture bookmarklet (third-choice capture method) */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-base font-semibold text-slate-100">
              Quick capture bookmarklet
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Drag the button below to your bookmarks bar, then click it on any
              job posting to save it. A small window opens with the details
              filled in for you to review.
            </p>
            <p className="mt-2 max-w-2xl text-sm text-amber-200/80">
              Works on most job boards. LinkedIn blocks bookmarklets, so use
              link import or the extension there.
            </p>

            <div className="mt-4">
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
                  className="inline-flex cursor-grab items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 py-2 text-sm font-medium text-sky-300 transition hover:bg-sky-500/20 active:cursor-grabbing"
                  title="Drag me to your bookmarks bar"
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v13.5a.5.5 0 01-.8.4L10 14.75 5.8 17.9a.5.5 0 01-.8-.4V4z" />
                  </svg>
                  Save to StrongerApplicant
                </a>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-500">
                  Preparing the bookmarklet…
                </span>
              )}
            </div>

            <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-slate-300">
              <li>
                Show your bookmarks bar (
                <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">
                  Cmd+Shift+B
                </code>{" "}
                on macOS,{" "}
                <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">
                  Ctrl+Shift+B
                </code>{" "}
                on Windows and Linux).
              </li>
              <li>Drag the button above up to it.</li>
              <li>Open a job posting and click the bookmark.</li>
              <li>Review the details and save.</li>
            </ol>

            <p className="mt-3 text-xs text-slate-500">
              Works in Chrome, Edge, and Firefox on desktop. To add a job
              without any setup, paste its link into + Add Application on the
              dashboard.
            </p>
          </section>

          {/* LLM / MCP access */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-base font-semibold text-slate-100">
              LLM / MCP Access
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Connect your tracker to Claude or any MCP-capable LLM client —
              it can read your applications, research, documents, and profile,
              and add/update applications.
            </p>

            <div className="mt-4 space-y-5">
              <div className="max-w-xl">
                <label htmlFor="mcp-endpoint" className={labelCls}>
                  MCP endpoint
                </label>
                <div className="flex gap-2">
                  <input
                    id="mcp-endpoint"
                    readOnly
                    value={MCP_ENDPOINT_URL}
                    className={`${inputCls} font-mono text-xs`}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      void copyText(MCP_ENDPOINT_URL, "Endpoint URL")
                    }
                    className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div className="max-w-xl">
                <label htmlFor="api-token" className={labelCls}>
                  API token
                </label>
                <div className="flex gap-2">
                  <input
                    id="api-token"
                    readOnly
                    value={apiToken ?? ""}
                    placeholder="Generated on first save"
                    className={`${inputCls} font-mono text-xs`}
                  />
                  <button
                    type="button"
                    onClick={() => void copyText(apiToken, "API token")}
                    disabled={!apiToken}
                    className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => void regenerateApiToken()}
                    disabled={regeneratingApiToken}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    {regeneratingApiToken && <Spinner className="h-3 w-3" />}
                    Regenerate
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  Sent as a Bearer token by your LLM client. Keep it secret —
                  regenerating invalidates the old one.
                </p>
              </div>

              <div>
                <p className={labelCls}>Add to Claude Code</p>
                <pre className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-950 p-3 text-xs leading-relaxed text-slate-300">
                  <code>{mcpAddCommand}</code>
                </pre>
              </div>
            </div>
          </section>

          {/* Account */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-base font-semibold text-slate-100">Account</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Change the password you use to sign in.
            </p>

            <div className="mt-4 max-w-xl space-y-4">
              <div>
                <label htmlFor="account-email" className={labelCls}>
                  Signed in as
                </label>
                <input
                  id="account-email"
                  readOnly
                  value={accountEmail ?? ""}
                  placeholder="—"
                  className={`${inputCls} text-slate-400`}
                />
              </div>
              <div>
                <label htmlFor="current-password" className={labelCls}>
                  Current password
                </label>
                <input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                  className={inputCls}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="new-password" className={labelCls}>
                    New password
                  </label>
                  <input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label htmlFor="confirm-new-password" className={labelCls}>
                    Confirm new password
                  </label>
                  <input
                    id="confirm-new-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className={inputCls}
                  />
                </div>
              </div>

              {passwordError && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-500/30 bg-red-950/40 px-3 py-2 text-sm text-red-300"
                >
                  {passwordError}
                </p>
              )}

              <button
                type="button"
                onClick={() => void updatePassword()}
                disabled={updatingPassword}
                className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
              >
                {updatingPassword && <Spinner className="h-3.5 w-3.5" />}
                {updatingPassword ? "Updating…" : "Update password"}
              </button>
              <p className="text-xs text-slate-500">
                At least 8 characters. We confirm your current password first.
                Updates immediately — no need to press the page&apos;s Save
                button.
              </p>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
