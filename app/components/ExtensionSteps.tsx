"use client";

import { SUPABASE_URL } from "@/lib/env";

/** Functions base URL the extension needs in its Options page. */
export const FUNCTIONS_BASE_URL = `${SUPABASE_URL}/functions/v1`;

/**
 * Compact numbered install steps for the Chrome extension, shared by the
 * Settings page and the Welcome checklist.
 */
export function ExtensionSteps() {
  return (
    <div className="space-y-3">
      <a
        href="/jobtracker-extension.zip"
        download
        className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-sky-400 transition hover:bg-slate-800"
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
          <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
        </svg>
        Download extension (.zip)
      </a>
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-300">
        <li>Unzip the downloaded file.</li>
        <li>
          Open{" "}
          <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">
            chrome://extensions
          </code>{" "}
          and enable <span className="font-medium">Developer mode</span>.
        </li>
        <li>
          Click <span className="font-medium">Load unpacked</span> and pick the
          unzipped folder.
        </li>
        <li>
          In the extension&apos;s <span className="font-medium">Options</span>,
          paste the Functions base URL{" "}
          <code className="break-all rounded bg-slate-800 px-1.5 py-0.5 text-xs">
            {FUNCTIONS_BASE_URL}
          </code>
          , your capture token (above), and this site&apos;s URL.
        </li>
      </ol>
    </div>
  );
}
