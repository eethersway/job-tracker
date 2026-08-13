/* JobTracker Capture — popup logic */

const $ = (id) => document.getElementById(id);

const views = {
  setup: $("setup-view"),
  loading: $("loading-view"),
  blocked: $("blocked-view"),
  form: $("capture-form"),
};

function showView(name) {
  for (const [key, el] of Object.entries(views)) {
    el.classList.toggle("hidden", key !== name);
  }
}

function openOptions() {
  chrome.runtime.openOptionsPage();
}

$("open-options").addEventListener("click", openOptions);
$("setup-btn").addEventListener("click", openOptions);

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      { functionsBaseUrl: "", captureToken: "", trackerUrl: "" },
      resolve
    );
  });
}

function setStatus(kind, html) {
  const el = $("status");
  el.className = `status visible ${kind}`;
  el.innerHTML = html;
}

function clearStatus() {
  const el = $("status");
  el.className = "status";
  el.innerHTML = "";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

async function extractFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error("No active tab found.");

  const tabUrl = tab.url || "";
  if (/^(chrome|edge|about|chrome-extension|devtools|view-source):/i.test(tabUrl)) {
    const err = new Error("Browser pages can't be captured. Open a job posting and try again.");
    err.blocked = true;
    throw err;
  }

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["extract.js"],
    });
  } catch (e) {
    const err = new Error(
      "Couldn't read this page (it may be a restricted page). You can still fill the form manually."
    );
    err.partial = { url: tabUrl };
    throw err;
  }

  const data = (results && results[0] && results[0].result) || {};
  return {
    company: data.company || "",
    title: data.title || "",
    location: data.location || "",
    salary: data.salary || "",
    description: data.description || "",
    url: data.url || tabUrl,
  };
}

function fillForm(data) {
  $("company").value = data.company || "";
  $("title").value = data.title || "";
  $("location").value = data.location || "";
  $("salary").value = data.salary || "";
  $("url").value = data.url || "";
  $("description").value = data.description || "";
}

async function saveJob(settings) {
  const payload = {
    company_name: $("company").value.trim(),
    job_title: $("title").value.trim(),
    job_url: $("url").value.trim(),
    job_description: $("description").value.trim(),
    location: $("location").value.trim(),
    salary: $("salary").value.trim(),
    source: "extension",
  };

  if (!payload.company_name || !payload.job_title) {
    throw new Error("Company and Job Title are required.");
  }

  const base = settings.functionsBaseUrl.replace(/\/+$/, "");
  const endpoint = `${base}/capture-job`;

  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-capture-token": settings.captureToken,
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new Error(
      "Network error — couldn't reach your tracker. Check the Functions base URL in settings."
    );
  }

  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    /* non-JSON response */
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error("Unauthorized — check your capture token in settings.");
  }
  if (!res.ok || !body || body.ok !== true) {
    const detail =
      (body && (body.error || body.message)) || `HTTP ${res.status} ${res.statusText}`;
    throw new Error(`Save failed: ${detail}`);
  }
  return body; // { ok: true, id }
}

async function init() {
  const settings = await getSettings();

  if (!settings.functionsBaseUrl || !settings.captureToken) {
    showView("setup");
    return;
  }

  showView("loading");

  try {
    const data = await extractFromActiveTab();
    fillForm(data);
    showView("form");
  } catch (e) {
    if (e.blocked) {
      $("blocked-msg").textContent = e.message;
      showView("blocked");
      return;
    }
    // Injection failed but we can still let the user type things in.
    fillForm(e.partial || {});
    showView("form");
    setStatus("error", escapeHtml(e.message));
  }

  $("capture-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    clearStatus();
    const btn = $("save-btn");
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Saving…';

    try {
      await saveJob(settings);
      btn.innerHTML = "Saved ✓";
      let html = "Saved ✓";
      if (settings.trackerUrl) {
        html += ` — <a href="${escapeHtml(settings.trackerUrl)}" target="_blank" rel="noopener">Open tracker</a>`;
      }
      setStatus("success", html);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "Save to Tracker";
      setStatus("error", escapeHtml(e.message));
    }
  });
}

init();
