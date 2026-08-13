# StrongerApplicant Capture — Chrome Extension

One-click job posting capture for [strongerapplicant.com](https://strongerapplicant.com) (or your own self-hosted instance).

## What it does

Click the extension icon on any job posting and it extracts the company, job title, location, salary (when listed), and the full description — using JSON-LD structured data, site-specific logic for LinkedIn / Greenhouse / Lever / Ashby / Workday / Indeed (including auto-expanding LinkedIn's "…more" collapsed descriptions), and a generic fallback for other sites. You review the fields in the popup, hit **Save to Tracker**, and the job lands in your dashboard as a "New" application. Company research starts automatically in the background.

## Install (load unpacked)

1. Download/unzip this folder
2. Open `chrome://extensions`, toggle **Developer mode** (top right)
3. Click **Load unpacked**, select this `extension/` folder

## Configure (one time)

Right-click the extension icon → **Options**:

| Field | Value |
|---|---|
| Functions base URL | `https://awebariljrravthdzujq.supabase.co/functions/v1` (self-hosters: your Supabase functions URL) |
| Capture token | From the app's **Settings** page — personal to your account, regenerable any time |
| Tracker dashboard URL | `https://strongerapplicant.com` (used for the "Open tracker" link) |

Captures authenticate with your capture token (sent as the `x-capture-token` header) and are saved to your account only.
