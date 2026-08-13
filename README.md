# StrongerApplicant

**Live at [strongerapplicant.com](https://strongerapplicant.com)**

An AI-powered job application tracker: capture postings in one click, get automatic company research, generate tailored resumes and cover letters with a fit assessment, and track every application through your pipeline.

![Dashboard](assets/dashboard.png)

## Features

- **Application pipeline** — statuses (Applied, Screening, Interviewing, Negotiating, Accepted, Rejected, Declined, Ghosted), search, sorting, notes, and per-status stat filters
- **One-click capture** — a Chrome extension extracts the company, title, location, and full description from LinkedIn and other job boards straight into your tracker
- **Automatic company research** — every captured job gets researched in the background: what the company does, size, industry, HQ, funding/investors, recent news, and why it matters for your role
- **Tailored resume generation** — rewrites your master resume for each specific job with strict rules: only relevant experience, achievement- and number-focused bullets, never fabricates anything, no em dashes
- **Call outs** — every resume comes with a short fit assessment: Strong/Moderate/Stretch, your strongest matches to emphasize, and gaps to be ready for
- **Cover letters** — specific, research-informed, 250–350 words, no clichés
- **PDF export** — print-formatted resumes and cover letters ready to send
- **LLM/MCP access** — connect Claude or any MCP client to your own tracker data
- **Multi-user** — sign up, your data is fully isolated from every other user (Postgres row-level security)

## Pricing

The app is **not free by default** — AI operations cost real money to run. There are two tiers:

| | Free tier | Credits tier |
|---|---|---|
| Requirement | Bring your own [Anthropic API key](https://console.anthropic.com) (added in Settings) | None — buy prepaid credits |
| Company research | free (billed to your key, ~$0.10) | **$0.25** |
| Tailored resume + call outs | free (billed to your key, ~$0.06) | **$0.25** |
| Cover letter | free (billed to your key, ~$0.04) | **$0.15** |
| Payment methods | — | Card via Stripe ($5 / $10 packs) · USDC on Base via x402 (beta) |

Notes: generating a resume for a job that hasn't been researched yet runs research first (so $0.50 total on credits — the button shows this before you click). Tracking applications, the extension, statuses, and notes are free on both tiers; only AI operations cost anything.

![Billing](assets/billing.png)

## The app, page by page

| Page | What it does |
|---|---|
| **Landing** (`/`) | Public homepage with features and pricing |
| **Dashboard** (`/dashboard`) | The pipeline: applications table, status filters, search, inline status editing |
| **Application detail** | Tabs for the job description, company research, tailored resumes, cover letters, and notes |
| **Profile** | Your resume source material: contact info, master resume, career highlights & numbers, skills & tools, extra context |
| **Settings** | Anthropic API key (free tier), extension capture token + install steps, MCP API token |
| **Billing** | Credit balance, buy credit packs, full transaction history |
| **Welcome** (`/welcome`) | First-login checklist: choose free-vs-credits, fill your profile, install the extension |

![Application detail — research](assets/research.png)
![Resume with call outs](assets/resume-callouts.png)

## Chrome extension

Captures the job posting on the current tab (LinkedIn, Greenhouse, Lever, Ashby, Workday, Indeed, plus a generic fallback for other sites), shows you the extracted fields for review, and saves to your tracker — company research starts automatically after every capture.

![Extension popup](assets/extension.png)

**Install** (until it's on the Chrome Web Store):

1. Download this repo (green **Code** button → Download ZIP) and unzip
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, select the `extension/` folder
3. Right-click the extension icon → **Options** and fill in:
   - **Functions base URL**: `https://awebariljrravthdzujq.supabase.co/functions/v1` (self-hosters: your own Supabase functions URL)
   - **Capture token**: from the app's **Settings** page (personal to you; regenerate any time)
   - **Tracker dashboard URL**: `https://strongerapplicant.com`
4. Open any job posting, click the icon, review, **Save to Tracker**

## MCP / API access

StrongerApplicant ships an MCP server so any MCP-capable LLM client (Claude Code, Claude Desktop, Cursor, ...) can read and update your tracker.

- Endpoint: `https://awebariljrravthdzujq.supabase.co/functions/v1/mcp` (Streamable HTTP)
- Auth: `Authorization: Bearer <API token>` — copy your API token from the Settings page
- Example (Claude Code):
  ```bash
  claude mcp add jobtracker --transport http https://awebariljrravthdzujq.supabase.co/functions/v1/mcp --header "Authorization: Bearer <token>"
  ```
- Tools: `list_applications`, `get_application`, `get_document`, `add_application`, `update_application`, `get_profile`, `get_stats`
- Scoped strictly to your own account; secrets (keys, tokens, balances) are never exposed through MCP

## Repository layout

```
app/                        Next.js 15 web app (Vercel)
extension/                  Chrome extension (Manifest V3)
supabase/schema.sql         Database schema (tables, RLS, triggers)
supabase/functions/         Edge functions: capture-job, research-company,
                            generate-document, create-checkout, stripe-webhook,
                            x402-topup, mcp
supabase/SETUP-PAYMENTS.md  Payments configuration runbook (self-hosting)
```

## Self-hosting

You can run the entire stack yourself for free (minus AI usage):

1. **Supabase**: create a free project, run `supabase/schema.sql` in the SQL editor, deploy the edge functions:
   ```bash
   supabase functions deploy research-company generate-document create-checkout x402-topup
   supabase functions deploy capture-job stripe-webhook mcp --no-verify-jwt
   ```
2. **Web app**: deploy `app/` to Vercel with env vars `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. **Payments (optional)**: follow `supabase/SETUP-PAYMENTS.md` for Stripe + x402 setup, or skip it and run BYO-API-key only
4. Sign up, follow the onboarding, and point the extension's Options at your own URLs

## Security

- Row-level security on every table — users can only ever read/write their own rows
- Per-user Anthropic API keys are stored in the user's own RLS-protected row and used only server-side
- The extension and MCP each use separate per-user random tokens, regenerable any time in Settings
- Stripe webhooks are signature-verified; credit grants are idempotent; spends are atomic with balance checks

**Stack:** Next.js 15 (Vercel) · Supabase (Postgres, Auth, Edge Functions) · Anthropic API · Stripe · x402 · Chrome extension (MV3)
