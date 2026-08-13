/* StrongerApplicant Capture — options page */

const $ = (id) => document.getElementById(id);

const DEFAULTS = { functionsBaseUrl: "", captureToken: "", trackerUrl: "" };

function setStatus(kind, text) {
  const el = $("status");
  el.className = `status visible ${kind}`;
  el.textContent = text;
  if (kind === "success") {
    setTimeout(() => {
      el.className = "status";
      el.textContent = "";
    }, 2500);
  }
}

function load() {
  chrome.storage.sync.get(DEFAULTS, (items) => {
    $("functionsBaseUrl").value = items.functionsBaseUrl;
    $("captureToken").value = items.captureToken;
    $("trackerUrl").value = items.trackerUrl;
  });
}

function normalizeUrl(value) {
  const v = value.trim().replace(/\/+$/, "");
  if (!v) return "";
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return v;
  } catch (e) {
    return null;
  }
}

$("options-form").addEventListener("submit", (ev) => {
  ev.preventDefault();

  const functionsBaseUrl = normalizeUrl($("functionsBaseUrl").value);
  if (functionsBaseUrl === null || functionsBaseUrl === "") {
    setStatus("error", "Enter a valid Functions base URL (https://…).");
    return;
  }

  const captureToken = $("captureToken").value.trim();
  if (!captureToken) {
    setStatus("error", "Capture token is required.");
    return;
  }

  let trackerUrl = $("trackerUrl").value.trim();
  if (trackerUrl) {
    const normalized = normalizeUrl(trackerUrl);
    if (normalized === null) {
      setStatus("error", "Tracker dashboard URL doesn't look valid.");
      return;
    }
    trackerUrl = normalized;
  }

  chrome.storage.sync.set({ functionsBaseUrl, captureToken, trackerUrl }, () => {
    if (chrome.runtime.lastError) {
      setStatus("error", `Couldn't save: ${chrome.runtime.lastError.message}`);
    } else {
      setStatus("success", "Settings saved ✓");
    }
  });
});

load();
