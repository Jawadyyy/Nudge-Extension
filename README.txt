# Nudge (v2.0)

Chrome extension for personalised cold outreach on LinkedIn — for job hunting,
recruiting, sales, networking, anything. Ships with NO personal data: on first
run you enter your own details, target companies and message templates.
Auto-personalises each message, automates bulk sending, tracks history, and
keeps you under safe daily limits.

---

## Install (2 minutes)

1. Unzip this folder somewhere (e.g. Desktop).
2. Open Chrome → chrome://extensions
3. Enable Developer Mode (top-right toggle).
4. Click "Load unpacked" → select this folder.
5. Pin the extension (puzzle-piece icon → pin).

If you change any file, click the reload (↻) button on the extension card.

---

## First run (one-time setup)

The first time you open the extension it lands on the Settings tab:

1. Enter your name, role, and a short pitch (1-2 sentences about you).
   Optionally add university/company, status, and a portfolio/GitHub URL.
2. Add your target companies (one per line).
3. Review the message templates — edit them or add your own.
4. Click "Save settings". You're ready to send.

Everything is stored locally on your device (chrome.storage). Nothing is
uploaded anywhere.

---

## What's new in v2.0

- Tabbed UI: Compose / Queue / History / Settings
- Auto-personalisation: {first_name} is scraped from the open profile at send time
- Editable templates + companies (no more hardcoded list) — edit in Settings
- Bulk Queue: paste many profile URLs, it opens each, sends, waits, repeats
- Safety: daily send cap + randomised delays + skip-already-messaged dedupe
- History log with sent/failed status, stats, and CSV export
- Connect-request mode with a personalised note
- "Type only" mode (fills the box but lets you press Send yourself)

---

## How to use

### Single send (Compose tab)
1. Open a person's LinkedIn profile.
2. Click the extension icon → Compose.
3. Pick a company + template (or edit the message; {first_name} fills itself).
4. Click "Auto-fill & send"  (or "Type only" to review before sending).

### Bulk send (Queue tab)
1. Set your message/template in Compose.
2. Go to Queue, paste one profile URL per line.
3. Click "Start queue". It opens a separate BACKGROUND tab and drives that
   through each profile, sending with random delays and stopping at your
   daily cap — your current tab stays free to use.
4. Watch the live log + progress bar (toolbar badge shows the count remaining).
   Hit Stop anytime. The background tab closes automatically when done.

### Connect requests
On a profile, the message box doubles as the invite note (max 300 chars).
Click "＋ Connect + note".

---

## Placeholders (use in any template)

{company} {first_name} {name} {role} {pitch} {uni} {year} {github} {headline}

{first_name}, {name} (recipient) and {headline} are filled from the live page.
The rest come from your profile in Settings. Unused placeholders resolve to
empty and surrounding whitespace is tidied up automatically.

---

## Safety / limits (Settings tab)

- Daily cap (default 10) — counter resets each day automatically. LinkedIn
  flags accounts sending 20+ messages/day, so keep this low.
  Connect requests count toward the same daily cap.
- Min/max delay between bulk sends (default 25–60s, randomised).
- Skip profiles already messaged (dedupe by URL).
- Auto-send toggle — turn off to only type and review.

NOTE: Automated messaging is against LinkedIn's Terms of Service and can get
your account restricted. The limits/delays reduce risk but don't eliminate it.
Use conservatively, on your own account, at your own discretion.

---

## Files

- manifest.json  — config (MV3, background worker, permissions)
- popup.html     — tabbed UI
- popup.js       — UI logic, single send, queue control, settings/history
- background.js  — service worker: daily counter + bulk queue processor
- content.js     — page scraping + message/connect automation
- icons/          — toolbar icons (16 / 48 / 128 px)
