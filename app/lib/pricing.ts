/**
 * Pay-as-you-go pricing for AI generations, in US cents.
 *
 * Users with their own Anthropic API key on their profile are never charged —
 * these prices only apply to the credits (pay-as-you-go) tier. Keep in sync
 * with the pricing enforced by the edge functions.
 */

/** Company research run. */
export const RESEARCH_PRICE_CENTS = 25;

/** Tailored resume generation. */
export const RESUME_PRICE_CENTS = 25;

/**
 * Extra charge added to a resume generation when company research has not
 * run yet for that company (generation runs it automatically first).
 */
export const RESUME_RESEARCH_SURCHARGE_CENTS = 25;

/** Cover letter generation. */
export const COVER_LETTER_PRICE_CENTS = 15;

/** Stripe credit packs accepted by the create-checkout edge function. */
export const CREDIT_PACKS_CENTS = [500, 1000] as const;

/** Format an amount in cents as dollars, e.g. 25 -> "$0.25", 500 -> "$5.00". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}
