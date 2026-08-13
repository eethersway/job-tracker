# Payments setup (owner runbook)

Billing works out of the box for BYO-key users (they add their own Anthropic key in Settings and pay nothing). For the paid credit tier you need to configure three secrets and one Stripe webhook.

## 1. Add the secrets

Secrets live in the `private.app_secrets` table and are read by the edge functions via the `get_secret()` RPC. Add or update them in the Supabase SQL editor (project `awebariljrravthdzujq`):

```sql
insert into private.app_secrets (key, value) values
  ('STRIPE_SECRET_KEY',     'sk_live_...'),
  ('STRIPE_WEBHOOK_SECRET', 'whsec_...'),
  ('X402_PAY_TO_ADDRESS',   '0xYourBaseUsdcAddress')
on conflict (key) do update set value = excluded.value;
```

- `STRIPE_SECRET_KEY` — from Stripe Dashboard > Developers > API keys.
- `STRIPE_WEBHOOK_SECRET` — the signing secret of the webhook endpoint you create in step 2 (`whsec_...`).
- `X402_PAY_TO_ADDRESS` — the wallet address that receives USDC on Base for x402 top-ups. This must be the **exact** receiving address (a `0x` + 40 hex string); it is compared byte-for-byte against the `to` address in the on-chain USDC Transfer log, so a typo or a different address means every payment is rejected and nothing is credited. **Base mainnet is assumed** (chain id 8453, USDC contract `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`); testnet payments will not verify.

Until a secret is set, the related function returns a clear error ("Stripe is not configured yet" / "x402 not configured") — nothing breaks for BYO-key users.

## 2. Create the Stripe webhook endpoint

Stripe Dashboard > Developers > Webhooks > Add endpoint:

- Endpoint URL: `https://awebariljrravthdzujq.supabase.co/functions/v1/stripe-webhook`
- Events to send:
  - `checkout.session.completed` — grants credits
  - `charge.refunded` — claws the refunded amount back
  - `charge.dispute.created` — claws the disputed amount back **and suspends the account**
  - `charge.dispute.funds_withdrawn` — same dispute, idempotent with the above

All four must be enabled, or a refunded/disputed customer keeps their credits.

Copy the endpoint's signing secret into `STRIPE_WEBHOOK_SECRET` (step 1). The function verifies signatures itself (JWT verification is disabled for it), credits `amount_total` cents to the user in `metadata.user_id`, and is idempotent per Stripe session id, so Stripe retries are safe.

Before crediting, the webhook also requires all of the following. Anything else is acknowledged with HTTP 200 but ignored, and logged with `console.error` (visible under Edge Functions > stripe-webhook > Logs):

- `metadata.purpose === "credits"` — set automatically by `create-checkout`, so only sessions this app created can mint credits
- `currency === "usd"`
- `livemode` matching your key: live events are only credited when `STRIPE_SECRET_KEY` starts with `sk_live_`. **Both** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` must be set, and both must be from the same mode (both test or both live), or nothing is credited
- `amount_total` of exactly 500 or 1000 cents (the two packs)

If you add a new pack size, update `ALLOWED_PACKS` in `supabase/functions/stripe-webhook/index.ts` and the `pack` check in `create-checkout` together.

## 3. Chargebacks, clawbacks and suspension

When a payment is refunded or disputed, the webhook debits the credits back out (`debit_credits`, flooring the balance at 0 and writing a negative ledger row of kind `clawback_refund` / `clawback_dispute`). Disputes also set `profile.suspended = true`, which makes `spend_credits` refuse further spending.

To find the buyer behind a refund or dispute, the webhook resolves in this order: metadata on the event, a local zero-delta `adjustment` ledger row holding the `payment_intent` → user mapping (written at credit time), the Stripe API (`GET /v1/checkout/sessions?payment_intent=...`), and finally the `purchase_stripe` ledger row for that session. Anything unresolvable is acknowledged with a 200 and a `console.error` — check the function logs, since retrying will not help.

Idempotency: index `credit_tx_clawback_ref_uniq` makes a given charge id or dispute id impossible to claw back twice. Note the consequence for **partial refunds** — the first `charge.refunded` event claws back `amount_refunded` and is keyed on the charge id, so a *second, larger* partial refund on the same charge is not clawed back automatically; it is logged with `console.error` naming the shortfall, and needs a manual `adjustment` ledger entry.

To lift a suspension after resolving a dispute:

```sql
update profile set suspended = false, suspended_reason = null where user_id = '<uuid>';
```

## 4. Central Anthropic key rotation

Paid-tier AI calls use the `CENTRAL_ANTHROPIC_KEY` row in `private.app_secrets`. Rotating the central Anthropic key = updating that row:

```sql
insert into private.app_secrets (key, value) values ('CENTRAL_ANTHROPIC_KEY', 'sk-ant-...')
on conflict (key) do update set value = excluded.value;
```

No redeploy needed — functions read it per request.

## Prices

- Company research: 25 cents (`spend_research`)
- Tailored resume: 25 cents (`spend_resume`) — plus 25 cents research if the company has not been researched yet
- Cover letter: 15 cents (`spend_cover_letter`)

Failed AI calls are automatically refunded to the ledger (`refund` kind).
