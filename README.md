# JobTracker

A self-hosted job application tracker with AI superpowers. Built as a free, own-your-data alternative to paid trackers like Hirecarta.

**Features**

- Application pipeline: statuses (Applied, Screening, Interviewing, Negotiating, Ghosted...), search, sorting, notes
- One-click job capture from LinkedIn and other job boards via a Chrome extension
- Automatic company research on every captured job (size, funding, products, recent news) using Claude with web search
- Tailored resume + cover letter generation from your master resume, with strict truthfulness rules and a "Call outs" fit assessment (Strong / Moderate / Stretch)
- PDF export with clean print formatting
- Multi-user: each user signs up, brings their own Anthropic API key, and only ever sees their own data (Postgres row-level security)

**Stack:** Next.js 15 (Vercel) · Supabase (Postgres, Auth, Edge Functions) · Anthropic API · Chrome extension (Manifest V3)

## Repository layout

```
app/                  Next.js web app
extension/            Chrome extension (load unpacked)
supabase/schema.sql   Database schema (tables, RLS, triggers)
supabase/functions/   Edge functions: capture-job, research-company, generate-document
```

## Using the Chrome extension

1. Download this repo (green **Code** button → Download ZIP) or grab `app/public/jobtracker-extension.zip`, and unzip
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, select the `extension/` folder
3. Right-click the extension icon → **Options** and fill in:
   - Functions base URL: `https://<your-supabase-ref>.supabase.co/functions/v1`
   - Capture token: from the tracker's Settings page
   - Tracker dashboard URL: your deployed app URL
4. Open any job posting, click the icon, review the extracted fields, **Save to Tracker**

## Self-hosting

1. **Supabase**: create a free project at supabase.com. In the SQL editor, run `supabase/schema.sql`. Deploy the three edge functions (Supabase CLI):
   ```bash
   supabase functions deploy research-company
   supabase functions deploy generate-document
   supabase functions deploy capture-job --no-verify-jwt
   ```
   (`capture-job` authenticates with per-user capture tokens instead of JWTs.)
2. **Web app**: deploy `app/` to Vercel (or any Next.js host). Set env vars:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
   ```
3. Sign up in the app, confirm your email, and follow the onboarding: add your Anthropic API key (console.anthropic.com), fill in your resume profile, install the extension.

Costs: Supabase and Vercel free tiers are enough for personal use. AI usage is billed to each user's own Anthropic API key (roughly a few cents per job for research + resume + cover letter).

## MCP / API access

JobTracker ships an MCP server so any MCP-capable LLM client (Claude Code, Claude Desktop, Cursor, ...) can read and update your tracker.

- Endpoint: `https://awebariljrravthdzujq.supabase.co/functions/v1/mcp` (Streamable HTTP)
- Auth: `Authorization: Bearer <API token>` — copy your API token from the Settings page (regenerate it there any time)
- Example (Claude Code):
  ```bash
  claude mcp add jobtracker --transport http https://awebariljrravthdzujq.supabase.co/functions/v1/mcp --header "Authorization: Bearer <token>"
  ```
- Tools: `list_applications`, `get_application`, `get_document`, `add_application`, `update_application`, `get_profile`, `get_stats`
- All access is read/write scoped to your own account: the API token maps to your user and every query is filtered to your data. Secrets (API keys, tokens, credit balance) are never exposed through MCP.

## Security notes

- All data tables use row-level security keyed to the authenticated user; users can only ever read/write their own rows.
- Anthropic API keys are stored per-user in their profile row (RLS-protected) and only used server-side in edge functions.
- The extension authenticates with a per-user random capture token, which can be regenerated at any time in Settings.
