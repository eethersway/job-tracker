# JobTracker Capture — Chrome Extension

Capture job postings from any site (LinkedIn, Greenhouse, Lever, Ashby, Workday, Indeed, or anything else) and save them to your self-hosted job tracker with one click.

## How it works

1. Open a job posting in a tab.
2. Click the JobTracker Capture icon in the toolbar.
3. The popup extracts the posting (JSON-LD structured data first, then site-specific selectors, then generic fallbacks) into an editable form.
4. Review/edit the fields and click **Save to Tracker**. The extension POSTs the job to your tracker's `capture-job` function.

The extension uses only `activeTab`, `scripting`, and `storage` permissions — it never reads pages in the background and shows no broad host-access warnings.

## Install (load unpacked)

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select this folder (`extension/` — the one containing `manifest.json`).
5. (Optional) Click the puzzle-piece icon in the toolbar and pin **JobTracker Capture**.

## Configure

1. Right-click the extension icon → **Options** (or click the gear in the popup).
2. Fill in:
   - **Functions base URL** — your functions endpoint base, e.g. `https://xyz.supabase.co/functions/v1`. Jobs are saved via `POST <base>/capture-job`.
   - **Capture token** — the shared secret your `capture-job` function expects; sent as the `x-capture-token` header.
   - **Tracker dashboard URL** — (optional) your tracker's web UI, used for the "Open tracker" link after a successful save.
3. Click **Save settings**. Settings sync via `chrome.storage.sync` across your Chrome profiles.

Until the base URL and token are set, the popup shows a "configure me" prompt.

## Request format

```
POST ${functionsBaseUrl}/capture-job
Content-Type: application/json
x-capture-token: <token>

{
  "company_name": "...",
  "job_title": "...",
  "job_url": "...",
  "job_description": "...",
  "location": "...",
  "salary": "...",
  "source": "extension"
}
```

Expected success response: `200` with `{ "ok": true, "id": "<uuid>" }`. Any other response is shown as a readable error in the popup.

## Notes

- LinkedIn URLs are canonicalized: `...?currentJobId=12345` becomes `https://www.linkedin.com/jobs/view/12345/`. Tracking params (`utm_*`, `gh_src`, `trk`, …) are stripped on other sites.
- Descriptions are trimmed to ~15,000 characters.
- Extraction is best-effort; every field is editable before saving.
- Browser-internal pages (`chrome://`, the Web Store, etc.) can't be captured.
