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
- `X402_PAY_TO_ADDRESS` — the wallet address that receives USDC on Base for x402 top-ups.

Until a secret is set, the related function returns a clear error ("Stripe is not configured yet" / "x402 not configured") — nothing breaks for BYO-key users.

## 2. Create the Stripe webhook endpoint

Stripe Dashboard > Developers > Webhooks > Add endpoint:

- Endpoint URL: `https://awebariljrravthdzujq.supabase.co/functions/v1/stripe-webhook`
- Events to send: `checkout.session.completed`

Copy the endpoint's signing secret into `STRIPE_WEBHOOK_SECRET` (step 1). The function verifies signatures itself (JWT verification is disabled for it), credits `amount_total` cents to the user in `metadata.user_id`, and is idempotent per Stripe session id, so Stripe retries are safe.

## 3. Central Anthropic key rotation

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
