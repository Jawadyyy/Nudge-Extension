// Popup controller — Compose / Queue / History / Settings.

// ---- Defaults --------------------------------------------------------------

const DEFAULT_SETTINGS = {
  onboarded: false,
  profile: {
    name: "",
    uni: "",
    year: "",
    role: "",
    github: "",
    pitch: "",
  },
  dailyLimit: 10,
  minDelaySec: 25,
  maxDelaySec: 60,
  skipDupes: true,
  autoSend: true,
};

// Empty by default — the user adds their own targets in Settings.
const DEFAULT_COMPANIES = [];

// Generic starter templates. All personal details come from placeholders.
const DEFAULT_TEMPLATES = [
  `Hi {first_name}, I'm {name}, {role}. {pitch}

I'd love to explore opportunities at {company}. Would you be open to a quick conversation?`,

  `Hello {first_name}! I'm {name} — {role}. {pitch}

I think {company} would be a great fit and wanted to reach out directly. Is there a good time to connect?`,
];

// ---- State -----------------------------------------------------------------

let S = null;          // settings
let companies = [];
let templates = [];
let tmplIndex = 0;
let currentCompany = "";

const $ = (id) => document.getElementById(id);

async function load() {
  const data = await chrome.storage.local.get(["settings", "companies", "templates"]);
  S = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  S.profile = { ...DEFAULT_SETTINGS.profile, ...(data.settings?.profile || {}) };
  companies = data.companies || DEFAULT_COMPANIES.slice();
  templates = data.templates || DEFAULT_TEMPLATES.slice();
}

async function save() {
  await chrome.storage.local.set({ settings: S, companies, templates });
}

// ---- Status ----------------------------------------------------------------

function updateHeader() {
  const p = S.profile;
  if (!p.name) {
    $("profile-name").textContent = "Set up your profile →";
    return;
  }
  $("profile-name").textContent = p.role ? `${p.name} · ${p.role}` : p.name;
}

function setStatus(msg, type) {
  const bar = $("status-bar");
  bar.textContent = msg;
  bar.className = "status " + type;
  if (type === "success" || type === "info") setTimeout(clearStatus, 2500);
}
function clearStatus() {
  $("status-bar").className = "status";
}

// ---- Placeholder resolution (everything except recipient name) -------------

function companyName(raw) {
  return (raw || "").split("·")[0].trim() || "your company";
}

function resolveTemplate(tpl, company) {
  const p = S.profile;
  let out = tpl;
  // Only resolve {company} when a target is chosen; otherwise leave it literal
  // so content.js can fall back to the recipient's scraped company at send time.
  if (company) out = out.replace(/\{company\}/gi, company);
  out = out
    .replace(/\{uni\}/gi, p.uni || "")
    .replace(/\{year\}/gi, p.year || "")
    .replace(/\{role\}/gi, p.role || "")
    .replace(/\{github\}/gi, p.github || "")
    .replace(/\{pitch\}/gi, p.pitch || "")
    .replace(/\{name\}/gi, p.name || "");
  // Tidy whitespace but keep {placeholders} intact.
  return out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  // {first_name}, recipient {name}, {headline}, {company} resolved on-page.
}

function buildMessage() {
  if (!templates.length) return "";
  return resolveTemplate(templates[tmplIndex % templates.length], currentCompany);
}

// ---- Compose tab -----------------------------------------------------------

function renderCompanySelect() {
  const sel = $("company-select");
  sel.innerHTML = '<option value="-1">— Select a company —</option>';
  companies.forEach((c, i) => {
    const o = document.createElement("option");
    o.value = i;
    o.textContent = c;
    sel.appendChild(o);
  });
  const o = document.createElement("option");
  o.value = "custom";
  o.textContent = "Custom / Other";
  sel.appendChild(o);
}

function renderTemplateSelect() {
  const sel = $("template-select");
  sel.innerHTML = "";
  templates.forEach((_, i) => {
    const o = document.createElement("option");
    o.value = i;
    o.textContent = "Variation " + (i + 1);
    sel.appendChild(o);
  });
  sel.value = tmplIndex;
}

function refreshMessage() {
  $("message").value = buildMessage();
  updateCharCount();
  updatePreview();
}

function updateCharCount() {
  $("char-count").textContent = $("message").value.length;
}

// #7 — live preview with demo values so the user sees the final message.
function updatePreview() {
  const box = $("preview-box");
  if (!box) return;
  const demo = $("message").value
    .replace(/\{first_?name\}/gi, "Alex")
    .replace(/\{name\}/gi, "Alex Carter")
    .replace(/\{company\}/gi, currentCompany || "their company")
    .replace(/\{headline\}/gi, "Engineering Manager");
  box.textContent = demo || "—";
}

function onCompanyChange() {
  const v = $("company-select").value;
  if (v === "-1") {
    currentCompany = "";
    $("tip-text").textContent = "No target selected — {company} auto-fills from the recipient's profile at send time.";
    refreshMessage();
    return;
  }
  if (v === "custom") {
    currentCompany = "";
    $("tip-text").textContent = "Custom target — type the company name over {company} in the message.";
  } else {
    currentCompany = companyName(companies[parseInt(v)]);
    $("tip-text").textContent = "Personalised for " + currentCompany + ". {first_name} auto-fills on the page.";
  }
  refreshMessage();
}

// ---- Page detection --------------------------------------------------------

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function detectPage() {
  const tab = await activeTab();
  const ind = $("page-type-indicator");
  if (!tab || !tab.url.includes("linkedin.com")) {
    ind.innerHTML = '<span class="dot dot-gray"></span>Not on LinkedIn — navigate there first';
    return;
  }
  if (tab.url.includes("/in/")) ind.innerHTML = '<span class="dot dot-green"></span>On a profile — ready to send';
  else if (tab.url.includes("/company/")) ind.innerHTML = '<span class="dot dot-green"></span>Company page — open a person\'s profile';
  else if (tab.url.includes("/messaging/")) ind.innerHTML = '<span class="dot dot-green"></span>Messaging — ready to send';
  else ind.innerHTML = '<span class="dot dot-gray"></span>Open a person\'s profile to send';
}

// ---- Single send -----------------------------------------------------------

async function ensureContent(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: "getPageInfo" });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  }
}

async function doSend({ autoSend }) {
  const message = $("message").value.trim();
  if (!message) return setStatus("⚠ Pick a company / write a message first.", "error");

  const tab = await activeTab();
  if (!tab.url.includes("linkedin.com")) return setStatus("⚠ Navigate to a LinkedIn profile first.", "error");

  const counter = await chrome.runtime.sendMessage({ type: "getCounter" });
  if (autoSend && counter.sent >= S.dailyLimit) {
    return setStatus(`⚠ Daily limit (${S.dailyLimit}) reached. Raise it in Settings.`, "error");
  }

  const btn = $("send-btn");
  const lbl = $("send-label");
  const orig = lbl.textContent;
  btn.disabled = true;
  lbl.textContent = "Sending…";

  try {
    await ensureContent(tab.id);
    const res = await chrome.tabs.sendMessage(tab.id, { action: "sendMessage", payload: { message, autoSend } });
    if (res?.success && res?.sent) {
      await chrome.runtime.sendMessage({
        type: "logSent",
        entry: { name: res.profile?.name || "", company: currentCompany || res.profile?.company || "", url: tab.url, status: "sent" },
      });
      setStatus("✓ " + res.message, "success");
      lbl.textContent = "Sent!";
      await refreshCounter();
    } else if (res?.success) {
      setStatus("ℹ " + res.message, "info");
    } else {
      setStatus("⚠ " + (res?.message || "Send failed."), "error");
    }
  } catch (e) {
    setStatus("Error: " + e.message, "error");
  } finally {
    setTimeout(() => { btn.disabled = false; lbl.textContent = orig; }, 2500);
  }
}

async function doConnect() {
  const note = $("message").value.trim().slice(0, 300); // LinkedIn note limit
  const tab = await activeTab();
  if (!tab.url.includes("/in/")) return setStatus("⚠ Open a person's profile to connect.", "error");

  const counter = await chrome.runtime.sendMessage({ type: "getCounter" });
  if (counter.sent >= S.dailyLimit) {
    return setStatus(`⚠ Daily limit (${S.dailyLimit}) reached. Raise it in Settings.`, "error");
  }
  try {
    await ensureContent(tab.id);
    const res = await chrome.tabs.sendMessage(tab.id, { action: "sendConnect", payload: { note } });
    if (res?.success) {
      await chrome.runtime.sendMessage({
        type: "logSent",
        entry: { name: res.profile?.name || "", company: currentCompany || res.profile?.company || "", url: tab.url, status: "sent", note: "connect" },
      });
      setStatus("✓ " + res.message, "success");
      await refreshCounter();
    } else {
      setStatus("⚠ " + (res?.message || "Connect failed."), "error");
    }
  } catch (e) {
    setStatus("Error: " + e.message, "error");
  }
}

// ---- Counter ---------------------------------------------------------------

async function refreshCounter() {
  const c = await chrome.runtime.sendMessage({ type: "getCounter" });
  $("counter").textContent = `${c.sent} / ${S.dailyLimit}`;
}

// ---- Queue tab -------------------------------------------------------------

function logLine(text, level) {
  const log = $("queue-log");
  const div = document.createElement("div");
  div.className = level || "info";
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

async function startQueue() {
  const message = $("message").value.trim();
  if (!message) return setStatus("⚠ Set a message in Compose first.", "error");

  const items = $("queue-urls").value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!items.length) return setStatus("⚠ Paste at least one profile URL.", "error");

  $("queue-log").innerHTML = "";
  $("queue-start").disabled = true;
  $("queue-stop").disabled = false;
  logLine(`Starting queue: ${items.length} profiles… (runs in a background tab)`, "info");

  // Queue runs in its own background tab (see background.js). Popup can close.
  chrome.runtime.sendMessage({
    type: "startQueue",
    payload: { items, message, settings: S },
  });
}

function stopQueue() {
  chrome.runtime.sendMessage({ type: "stopQueue" });
  logLine("Stop requested…", "warn");
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "queueLog") logLine(msg.text, msg.level);
  if (msg.type === "queueProgress") {
    const pct = Math.round((msg.done / msg.total) * 100);
    $("queue-bar").style.width = pct + "%";
    $("queue-progress-text").textContent = `${msg.done}/${msg.total} processed · ${msg.sent} sent`;
    refreshCounter();
  }
  if (msg.type === "queueDone") {
    $("queue-start").disabled = false;
    $("queue-stop").disabled = true;
    logLine(msg.stopped ? "Queue stopped." : `Done. ${msg.sent} sent of ${msg.total}.`, msg.stopped ? "warn" : "ok");
    refreshCounter();
    renderHistory();
  }
});

// ---- History tab -----------------------------------------------------------

const HIST_PAGE = 50;
let histShown = HIST_PAGE;

async function renderHistory(reset = true) {
  const { history = [] } = await chrome.storage.local.get("history");
  const counter = await chrome.runtime.sendMessage({ type: "getCounter" });
  const sent = history.filter((h) => h.status === "sent");
  const failed = history.filter((h) => h.status === "failed");
  $("stat-today").textContent = counter.sent;
  $("stat-total").textContent = sent.length;
  $("stat-fail").textContent = failed.length;

  if (reset) histShown = HIST_PAGE;

  const list = $("hist-list");
  if (!history.length) {
    list.innerHTML = '<div class="empty">No outreach yet. Sent messages show up here.</div>';
    return;
  }
  list.innerHTML = "";
  history.slice(0, histShown).forEach((h) => {
    const div = document.createElement("div");
    div.className = "hist-item";
    const when = new Date(h.time).toLocaleString();
    div.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center">
        <span class="name">${escapeHtml(h.name || "(unknown)")}</span>
        <span class="badge ${h.status}">${h.status}</span>
      </div>
      <div class="sub">${escapeHtml(h.company || "")} · ${when}</div>`;
    list.appendChild(div);
  });

  if (history.length > histShown) {
    const more = document.createElement("button");
    more.className = "btn btn-secondary";
    more.style.cssText = "width:calc(100% - 32px);margin:10px 16px";
    more.textContent = `Load more (${history.length - histShown} more)`;
    more.addEventListener("click", () => {
      histShown += HIST_PAGE;
      renderHistory(false);
    });
    list.appendChild(more);
  }
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

async function exportCsv() {
  const { history = [] } = await chrome.storage.local.get("history");
  if (!history.length) return setStatus("No history to export.", "info");
  const rows = [["name", "company", "status", "url", "time", "note"]];
  history.forEach((h) =>
    rows.push([h.name || "", h.company || "", h.status || "", h.url || "", new Date(h.time).toISOString(), h.note || ""])
  );
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "nudge-export.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus("✓ CSV exported.", "success");
}

async function clearHistory() {
  await chrome.storage.local.set({ history: [] });
  renderHistory();
  setStatus("History cleared.", "info");
}

// ---- Settings tab ----------------------------------------------------------

function renderSettings() {
  $("set-name").value = S.profile.name;
  $("set-uni").value = S.profile.uni;
  $("set-year").value = S.profile.year;
  $("set-role").value = S.profile.role;
  $("set-github").value = S.profile.github;
  $("set-pitch").value = S.profile.pitch || "";
  $("set-limit").value = S.dailyLimit;
  $("set-mindelay").value = S.minDelaySec;
  $("set-maxdelay").value = S.maxDelaySec;
  $("set-skipdupes").checked = S.skipDupes;
  $("set-autosend").checked = S.autoSend;
  $("set-companies").value = companies.join("\n");
  renderTmplList();
}

function renderTmplList() {
  const wrap = $("tmpl-list");
  wrap.innerHTML = "";
  templates.forEach((t, i) => {
    const div = document.createElement("div");
    div.className = "tmpl-item";
    div.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin:0">Variation ${i + 1}</label>
        <button class="btn btn-danger" data-del="${i}" style="padding:3px 8px;font-size:11px">Delete</button>
      </div>`;
    const ta = document.createElement("textarea");
    ta.rows = 5;
    ta.value = t;
    ta.dataset.tmpl = i;
    div.appendChild(ta);
    wrap.appendChild(div);
  });
}

async function saveSettings() {
  if (!$("set-name").value.trim()) {
    return setStatus("⚠ Enter your full name before saving.", "error");
  }

  // #9 — validate delays before committing anything.
  const minD = parseInt($("set-mindelay").value) || 25;
  const maxD = parseInt($("set-maxdelay").value) || 60;
  if (maxD < minD) {
    return setStatus("⚠ Max delay must be ≥ min delay.", "error");
  }

  S.profile.name = $("set-name").value.trim();
  S.profile.uni = $("set-uni").value.trim();
  S.profile.year = $("set-year").value.trim();
  S.profile.role = $("set-role").value.trim();
  S.profile.github = $("set-github").value.trim();
  S.profile.pitch = $("set-pitch").value.trim();
  S.onboarded = true;
  $("welcome-banner").style.display = "none";
  S.dailyLimit = parseInt($("set-limit").value) || 10;
  S.minDelaySec = minD;
  S.maxDelaySec = maxD;
  S.skipDupes = $("set-skipdupes").checked;
  S.autoSend = $("set-autosend").checked;
  companies = $("set-companies").value.split("\n").map((s) => s.trim()).filter(Boolean);
  templates = [...document.querySelectorAll("[data-tmpl]")].map((ta) => ta.value).filter((t) => t.trim());
  if (!templates.length) templates = DEFAULT_TEMPLATES.slice();

  await save();
  updateHeader();
  renderCompanySelect();
  renderTemplateSelect();
  refreshCounter();
  setStatus("✓ Settings saved.", "success");
}

// ---- Tabs ------------------------------------------------------------------

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === "panel-" + name));
  if (name === "history") renderHistory();
  if (name === "settings") renderSettings();
}

// ---- Wire up ---------------------------------------------------------------

async function init() {
  await load();

  updateHeader();
  renderCompanySelect();
  renderTemplateSelect();
  await refreshCounter();
  detectPage();

  // If a queue is already running in the background, reflect that.
  const qs = await chrome.runtime.sendMessage({ type: "queueStatus" }).catch(() => null);
  if (qs?.running) {
    $("queue-start").disabled = true;
    $("queue-stop").disabled = false;
  }

  // First run: send the user straight to Settings with a welcome prompt.
  if (!S.onboarded) {
    switchTab("settings");
    $("welcome-banner").style.display = "block";
    setStatus("Welcome — fill in your details and save to get started.", "info");
  }

  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));
  document.querySelectorAll("[data-tab-link]").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); switchTab(a.dataset.tabLink); })
  );

  $("company-select").addEventListener("change", onCompanyChange);
  $("template-select").addEventListener("change", (e) => { tmplIndex = parseInt(e.target.value); refreshMessage(); });
  $("message").addEventListener("input", () => { updateCharCount(); updatePreview(); });

  $("btn-regen").addEventListener("click", () => {
    if (!templates.length) return;
    tmplIndex = (tmplIndex + 1) % templates.length;
    $("template-select").value = tmplIndex;
    refreshMessage();
    setStatus(`Variation ${tmplIndex + 1} of ${templates.length}`, "info");
  });
  $("btn-copy").addEventListener("click", () => {
    navigator.clipboard.writeText($("message").value).then(() => setStatus("✓ Copied.", "success"));
  });

  $("send-btn").addEventListener("click", () => doSend({ autoSend: true }));
  $("btn-typeonly").addEventListener("click", () => doSend({ autoSend: false }));
  $("btn-connect").addEventListener("click", doConnect);

  $("queue-start").addEventListener("click", startQueue);
  $("queue-stop").addEventListener("click", stopQueue);

  $("hist-export").addEventListener("click", exportCsv);
  $("hist-clear").addEventListener("click", clearHistory);

  $("set-save").addEventListener("click", saveSettings);
  $("tmpl-add").addEventListener("click", () => { templates.push("Hi {first_name}, …"); renderTmplList(); });
  $("tmpl-list").addEventListener("click", (e) => {
    const del = e.target.dataset?.del;
    if (del !== undefined) {
      templates = [...document.querySelectorAll("[data-tmpl]")].map((ta) => ta.value);
      templates.splice(parseInt(del), 1);
      renderTmplList();
    }
  });

  // Populate the Compose box + preview with the current template right away.
  refreshMessage();
}

init();
