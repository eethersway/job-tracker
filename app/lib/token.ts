/**
 * Generates a random 48-character hex token for the Chrome extension's
 * capture endpoint (stored on profile.capture_token).
 */
export function generateCaptureToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
