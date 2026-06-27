// Content script — runs on linkedin.com pages.
// Provides page scraping + message/connect automation. Driven by the popup
// and the background service worker via chrome.runtime / chrome.scripting.

(function () {
  "use strict";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- Scraping ------------------------------------------------------------

  // Prefer stable landmarks (main, h1, aria-*) over LinkedIn's churny class
  // names. Each field tries semantic selectors first, class names last.
  function pickText(selectors) {
    for (const s of selectors) {
      const el = document.querySelector(s);
      const t = el && el.textContent ? el.textContent.replace(/\s+/g, " ").trim() : "";
      if (t) return t;
    }
    return "";
  }

  function scrapeProfile() {
    const out = { name: "", firstName: "", headline: "", company: "", url: location.href };

    // Recipient name: profile heading inside <main>, else open message thread.
    out.name = pickText([
      "main section h1", // stable landmark on a profile page
      "main h1",
      "h1",
      ".msg-overlay-bubble-header__title", // overlay conversation
      ".msg-thread__link-to-profile",
      "[data-control-name='overlay.expand_conversation'] h2",
    ]).split("\n")[0].trim();
    out.firstName = (out.name.split(" ")[0] || "").trim();

    // Headline: semantic data-attr / position relative to h1, class as fallback.
    out.headline = pickText([
      "main section .text-body-medium.break-words",
      "main h1 ~ div.text-body-medium",
      ".pv-text-details__left-panel .text-body-medium",
      ".text-body-medium.break-words",
    ]);

    // Current company: aria-labelled experience button first.
    out.company = pickText([
      "[aria-label^='Current company']",
      "[aria-label*='Current company']",
      "button[aria-label*='Current company'] span[aria-hidden='true']",
      ".pv-text-details__right-panel button span[aria-hidden='true']",
    ]);

    // Selector-rot warning: if we're on a profile but got no name, the DOM
    // probably changed. Surface it so the user knows scraping broke.
    if (!out.name && /\/in\//.test(location.pathname)) {
      console.warn("[Nudge] Could not scrape recipient name — LinkedIn selectors may have changed. {first_name} will fall back to 'there'.");
      out.scrapeFailed = true;
    }

    return out;
  }

  // ---- Element finders -----------------------------------------------------

  function findMessageBox() {
    const selectors = [
      '.msg-form__contenteditable[contenteditable="true"]',
      '[data-artdeco-is-focused] .msg-form__contenteditable',
      '.msg-form__contenteditable',
      '[role="textbox"][contenteditable="true"]',
      '.ql-editor[contenteditable="true"]',
    ];
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  function findSendButton() {
    const selectors = [
      "button.msg-form__send-button",
      'button[type="submit"].msg-form__send-button',
      ".msg-form__send-btn",
      'button[aria-label="Send"]',
      'button[aria-label*="Send"]',
    ];
    for (const s of selectors) {
      const b = document.querySelector(s);
      if (b && !b.disabled && b.offsetParent !== null) return b;
    }
    return null;
  }

  function findMessageButton() {
    return [...document.querySelectorAll("button, a")].find((b) => {
      const t = b.textContent.trim().toLowerCase();
      const aria = (b.getAttribute("aria-label") || "").toLowerCase();
      return (
        (t === "message" || aria.startsWith("message")) && b.offsetParent !== null
      );
    });
  }

  function findConnectButton() {
    return [...document.querySelectorAll("button")].find((b) => {
      const t = b.textContent.trim().toLowerCase();
      const aria = (b.getAttribute("aria-label") || "").toLowerCase();
      return (t === "connect" || aria.startsWith("connect")) && b.offsetParent !== null;
    });
  }

  // ---- Typing --------------------------------------------------------------

  function selectAllIn(el) {
    el.focus();
    el.click();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Insert text into a contenteditable without the deprecated execCommand
  // insertText path. Primary: synthetic paste with a DataTransfer payload
  // (React/Quill listen for the 'paste' event). Fallback: beforeinput, then
  // execCommand as a last resort for older surfaces.
  function typeIntoField(el, text) {
    selectAllIn(el);

    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    const pasteEvt = new ClipboardEvent("paste", {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(pasteEvt);

    // If the surface ignored the synthetic paste, fall back.
    if (!el.textContent.trim()) {
      try {
        const ok = el.dispatchEvent(
          new InputEvent("beforeinput", {
            inputType: "insertText",
            data: text,
            bubbles: true,
            cancelable: true,
          })
        );
        if (!el.textContent.trim() && ok) {
          // Last resort — legacy execCommand line-by-line.
          selectAllIn(el);
          document.execCommand("delete", false, null);
          text.split("\n").forEach((line, i) => {
            if (i > 0) document.execCommand("insertParagraph", false, null);
            if (line) document.execCommand("insertText", false, line);
          });
        }
      } catch (_) {
        /* ignore — input event below still fires */
      }
    }

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function resolvePlaceholders(text, profile) {
    return text
      .replace(/\{first_?name\}/gi, profile.firstName || "there")
      .replace(/\{name\}/gi, profile.name || "there")
      .replace(/\{headline\}/gi, profile.headline || "")
      // Any {company} left unresolved by the popup (no target selected) falls
      // back to the recipient's current company scraped from their profile.
      .replace(/\{company\}/gi, profile.company || "your company");
  }

  // ---- Actions -------------------------------------------------------------

  async function sendMessage({ message, autoSend = true, openTimeoutMs = 12000 }) {
    const profile = scrapeProfile();
    const finalMsg = resolvePlaceholders(message, profile);

    let box = findMessageBox();

    if (!box) {
      const msgBtn = findMessageButton();
      if (msgBtn) {
        msgBtn.click();
        const start = Date.now();
        while (!box && Date.now() - start < openTimeoutMs) {
          await sleep(400);
          box = findMessageBox();
        }
      }
    }

    if (!box) {
      return {
        success: false,
        profile,
        message: "Could not find a message box. Open the profile and click Message manually, then retry.",
      };
    }

    typeIntoField(box, finalMsg);
    await sleep(700);

    if (!autoSend) {
      return { success: true, profile, sent: false, message: "Message typed — review and press Send manually." };
    }

    const sendBtn = findSendButton();
    if (sendBtn) {
      sendBtn.click();
      await sleep(400);
      return { success: true, profile, sent: true, message: "Message sent to " + (profile.name || "recipient") + "." };
    }
    return { success: true, profile, sent: false, message: "Message typed — Send button not found. Press Enter to send." };
  }

  async function sendConnect({ note = "", openTimeoutMs = 8000 }) {
    const profile = scrapeProfile();
    const connectBtn = findConnectButton();
    if (!connectBtn) {
      return { success: false, profile, message: "No Connect button on this page." };
    }
    connectBtn.click();
    await sleep(1200);

    if (note) {
      const addNote = [...document.querySelectorAll("button")].find(
        (b) => b.textContent.trim().toLowerCase().includes("add a note")
      );
      if (addNote) {
        addNote.click();
        await sleep(800);
        const noteBox = document.querySelector("textarea#custom-message, textarea[name='message']");
        if (noteBox) {
          const finalNote = resolvePlaceholders(note, profile);
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
          setter.call(noteBox, finalNote);
          noteBox.dispatchEvent(new Event("input", { bubbles: true }));
          await sleep(500);
        }
      }
    }

    const sendInvite = [...document.querySelectorAll("button")].find((b) => {
      const aria = (b.getAttribute("aria-label") || "").toLowerCase();
      return aria.includes("send") || b.textContent.trim().toLowerCase() === "send";
    });
    if (sendInvite) {
      sendInvite.click();
      return { success: true, profile, sent: true, message: "Connection request sent to " + (profile.name || "recipient") + "." };
    }
    return { success: false, profile, message: "Connect dialog opened but Send not found." };
  }

  // ---- Message router ------------------------------------------------------

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getPageInfo") {
      const p = scrapeProfile();
      sendResponse({
        url: location.href,
        title: document.title,
        profile: p,
        hasMessageBox: !!findMessageBox(),
        hasMessageButton: !!findMessageButton(),
        hasConnectButton: !!findConnectButton(),
      });
      return true;
    }
    if (request.action === "sendMessage") {
      sendMessage(request.payload).then(sendResponse);
      return true;
    }
    if (request.action === "sendConnect") {
      sendConnect(request.payload).then(sendResponse);
      return true;
    }
    return true;
  });
})();
