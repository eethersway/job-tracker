import type { NextConfig } from "next";

/**
 * Content Security Policy.
 *
 * 'unsafe-inline' and 'unsafe-eval' in script-src are required: Next 15's App
 * Router injects inline bootstrap/flight scripts, and without a nonce-based
 * setup (which needs middleware to stamp every request) a stricter policy
 * breaks hydration outright. style-src needs 'unsafe-inline' for the same
 * reason plus Tailwind's injected styles.
 *
 * connect-src covers Supabase REST/auth/realtime/functions and Stripe's API.
 * form-action allows the Stripe Checkout redirect.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com",
  "object-src 'none'",
].join("; ");

/** Headers applied to every route. */
const baseHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Everything except the print route, which gets the same headers
        // minus the CSP (see below).
        source:
          "/((?!application/[^/]+/print/).*)",
        headers: [...baseHeaders, { key: "Content-Security-Policy", value: CSP }],
      },
      {
        // The print view injects a large inline <style> block and calls
        // window.print(). It keeps the clickjacking/sniffing protections but
        // is deliberately left out of the CSP so printing cannot break.
        source: "/application/:id/print/:docId",
        headers: baseHeaders,
      },
    ];
  },
};

export default nextConfig;
