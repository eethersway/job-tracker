"use client";

import ReactMarkdown from "react-markdown";

/** Renders markdown with the app's dark-theme styles. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
