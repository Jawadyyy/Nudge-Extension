// Background service worker.
// Owns: daily send counter (auto-reset), and the bulk queue processor that
// drives one tab through a list of profile URLs with human-like delays.

const DAY_MS = 24 * 60 * 60 * 1000;

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);

async function get(keys) {
  return chrome.storage.local.get(keys);
}
async function set(obj) {
  return chrome.storage.local.set(obj);
}

// ---- Daily counter ---------------------------------------------------------

async function getCounter() {
  const { counter } = await get("counter");
  if (!counter || counter.date !== today()) {
    const fresh = { date: today(), sent: 0 };
    await set({ counter: fresh });
    return fresh;
  }
  return counter;
}

async function bumpCounter(n = 1) {
  const c = await getCounter();
  c.sent += n;
  await set({ counter: c });
  return c;
}

// ---- History ---------------------------------------------------------------

async function addHistory(entry) {
  const { history = [] } = await get("history");
  history.unshift({ ...entry, time: Date.now() });
  await set({ history: history.slice(0, 1000) });
}

async function alreadyMessaged(url) {
  const { history = [] } = await get("history");
  const clean = (u) => (u || "").split("?")[0].replace(/\/$/, "");
  return history.some((h) => h.status === "sent" && clean(h.url) === clean(url));
}

// ---- Queue state -----------------------------------------------------------

let queueRunning = false;
let queueStop = false;

function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function sendToTab(tabId, msg) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(resp);
    });
  });
}

function waitForTabComplete(tabId, timeoutMs = 25000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) return resolve(false);
        if (tab.status === "complete") return resolve(true);
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(check, 500);
      });
    };
    check();
  });
}

function setBadge(text, color = "#0a66c2") {
  if (!chrome.action) return;
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text: String(text) });
}

async function runQueue({ items, message, settings }) {
  if (queueRunning) return { ok: false, error: "Queue already running." };
  queueRunning = true;
  queueStop = false;

  const minDelay = (settings.minDelaySec ?? 25) * 1000;
  const maxDelay = (settings.maxDelaySec ?? 60) * 1000;
  const dailyLimit = settings.dailyLimit ?? 10;
  const skipDupes = settings.skipDupes !== false;

  // #4 — run the queue in its own background tab so the user's tab is free.
  let tabId;
  try {
    const qtab = await chrome.tabs.create({ url: "about:blank", active: false });
    tabId = qtab.id;
  } catch (e) {
    queueRunning = false;
    return { ok: false, error: "Could not open a queue tab: " + e.message };
  }
  setBadge("…");

  let done = 0;
  let sent = 0;

  for (let i = 0; i < items.length; i++) {
    if (queueStop) break;

    const counter = await getCounter();
    if (counter.sent >= dailyLimit) {
      broadcast({ type: "queueLog", level: "warn", text: `Daily limit (${dailyLimit}) reached. Stopping.` });
      break;
    }

    const url = items[i].trim();
    if (!url) continue;

    if (skipDupes && (await alreadyMessaged(url))) {
      broadcast({ type: "queueLog", level: "info", text: `Skipped (already messaged): ${url}` });
      done++;
      broadcast({ type: "queueProgress", done, total: items.length, sent });
      continue;
    }

    broadcast({ type: "queueLog", level: "info", text: `Opening ${url}` });
    await chrome.tabs.update(tabId, { url });
    await waitForTabComplete(tabId);
    await sleep(rand(2500, 4500)); // let lazy content render

    const payload = { message, autoSend: settings.autoSend !== false };
    let result;
    try {
      result = await sendToTab(tabId, { action: "sendMessage", payload });
    } catch (e1) {
      // Content script may not be injected yet on a fresh nav — inject + retry.
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
        await sleep(1500);
        result = await sendToTab(tabId, { action: "sendMessage", payload });
      } catch (e2) {
        result = { success: false, message: e2.message };
      }
    }

    const profile = result?.profile || {};
    if (result?.success && result?.sent) {
      sent++;
      await bumpCounter(1);
      await addHistory({ name: profile.name || "", company: profile.company || "", url, status: "sent" });
      broadcast({ type: "queueLog", level: "ok", text: `Sent to ${profile.name || url}` });
    } else {
      await addHistory({ name: profile.name || "", company: profile.company || "", url, status: "failed", note: result?.message || "" });
      broadcast({ type: "queueLog", level: "error", text: `Failed: ${result?.message || url}` });
    }

    done++;
    setBadge(items.length - done);
    broadcast({ type: "queueProgress", done, total: items.length, sent });

    if (i < items.length - 1 && !queueStop) {
      const wait = rand(minDelay, maxDelay);
      broadcast({ type: "queueLog", level: "info", text: `Waiting ${Math.round(wait / 1000)}s before next…` });
      await sleep(wait);
    }
  }

  // Close the dedicated queue tab; the user's original tab stays focused.
  try { await chrome.tabs.remove(tabId); } catch (_) {}
  setBadge("");
  queueRunning = false;
  broadcast({ type: "queueDone", done, total: items.length, sent, stopped: queueStop });
  return { ok: true, done, sent };
}

// ---- Router ----------------------------------------------------------------

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.type === "startQueue") {
    runQueue(req.payload).then(sendResponse);
    return true;
  }
  if (req.type === "stopQueue") {
    queueStop = true;
    sendResponse({ ok: true });
    return true;
  }
  if (req.type === "queueStatus") {
    sendResponse({ running: queueRunning });
    return true;
  }
  if (req.type === "getCounter") {
    getCounter().then(sendResponse);
    return true;
  }
  if (req.type === "logSent") {
    // single-send path from the Compose tab.
    (async () => {
      await bumpCounter(1);
      await addHistory(req.entry);
      sendResponse({ ok: true });
    })();
    return true;
  }
  return false;
});

// Midnight reset alarm (counter also self-resets on read, this just nudges UI).
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("dailyReset", { periodInMinutes: 60 });
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "dailyReset") getCounter();
});
