"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/AppShell";
import { LoadingBlock, Spinner } from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { ExtensionSteps, FUNCTIONS_BASE_URL } from "@/components/ExtensionSteps";
import { formatDateTime } from "@/lib/format";
import { generateCaptureToken } from "@/lib/token";
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

  async function handleSave() {
    setSaving(true);
    try {
      const supabase = createClient();
      const userId = (await supabase.auth.getUser()).data.user!.id;
      // Auto-generate tokens on first save if none exist yet.
      const token = captureToken ?? generateCaptureToken();
      const mcpToken = apiToken ?? generateCaptureToken();
      // Only the fields this page owns — never resume/contact content
      // (that belongs to the Profile page).
      const row = {
        user_id: userId,
        anthropic_api_key: anthropicKey.trim() || null,
        capture_token: token,
        api_token: mcpToken,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("profile")
        .upsert(row, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
      setCaptureToken(token);
      setApiToken(mcpToken);
      setProfile((prev) => (prev ? { ...prev, ...row } : prev));
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
      const userId = (await supabase.auth.getUser()).data.user!.id;
      const token = generateCaptureToken();
      const { error } = await supabase.from("profile").upsert(
        {
          user_id: userId,
          api_token: token,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
      if (error) throw new Error(error.message);
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

  const mcpAddCommand = `claude mcp add jobtracker --transport http ${MCP_ENDPOINT_URL} --header "Authorization: Bearer ${
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
        </div>
      )}
    </AppShell>
  );
}
