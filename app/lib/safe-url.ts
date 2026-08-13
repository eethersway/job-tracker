/**
 * URL safety guard.
 *
 * Job URLs and company websites reach us from untrusted places: the capture
 * bookmarklet (payload posted by an arbitrary page), the import-url function
 * (scraped page content), manual entry, and LLM output in company research.
 * Rendering any of those straight into href would let a `javascript:` (or
 * `data:`/`vbscript:`) URL execute script on OUR origin when clicked, which
 * would expose the Supabase session and everything it protects (the user's
 * Anthropic key, capture token, and API token).
 *
 * Only absolute http(s) URLs are ever safe to link to here.
 */

/**
 * Return the URL only when it is an absolute http(s) URL, else null.
 * Callers should render the raw value as plain text when this returns null,
 * so the user can still see what was captured.
 */
export function safeHref(u: string | null | undefined): string | null {
  if (typeof u !== "string") return null;
  const trimmed = u.trim();
  if (!trimmed) return null;
  try {
    // Relative values throw here, which is what we want: an href we cannot
    // fully resolve is not one we should trust.
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

/** True when the value is safe to use as an href (see safeHref). */
export function isSafeHref(u: string | null | undefined): boolean {
  return safeHref(u) !== null;
}
