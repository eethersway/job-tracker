"use client";

import ReactMarkdown from "react-markdown";
import { safeHref } from "@/lib/safe-url";

/**
 * Renders markdown with the app's dark-theme styles.
 *
 * The markdown we render is AI-generated (company research, resumes, cover
 * letters), so link and image URLs inside it are untrusted. react-markdown
 * sanitizes URLs by default, but we pass an explicit transform so the policy
 * is visible here and cannot regress if that default ever changes: only
 * absolute http(s) URLs survive, everything else is dropped.
 */
function urlTransform(url: string): string {
  return safeHref(url) ?? "";
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown urlTransform={urlTransform}>{children}</ReactMarkdown>
    </div>
  );
}
