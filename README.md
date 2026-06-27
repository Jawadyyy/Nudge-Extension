# Nudge

**Personalised cold outreach on LinkedIn — directly from your browser.**

Nudge is a Chrome extension that auto-personalises messages, automates bulk sending, tracks history, and keeps you under safe daily limits. Everything runs locally — no data leaves your device.

---

## Features

- **Auto-personalisation** — `{first_name}`, `{company}`, `{role}`, `{pitch}` and more fill themselves from the open profile and your settings
- **Bulk Queue** — paste a list of profile URLs, Nudge drives a background tab through each one with randomised delays
- **Connect requests** — send personalised connection notes (counts toward daily cap)
- **History log** — sent/failed status per recipient, stats, CSV export
- **Safety limits** — daily send cap (default 10), min/max delay, skip-already-messaged dedupe
- **Type-only mode** — fills the message box but lets you press Send yourself
- **100% local** — all data stored in `chrome.storage`, nothing uploaded anywhere

---

## Install

1. Download or clone this repo
2. Open Chrome → `chrome://extensions`
3. Enable **Developer Mode** (top-right toggle)
4. Click **Load unpacked** → select the repo folder
5. Pin the extension (puzzle-piece icon → pin)

---

## First Run

On first open, Nudge lands on the Settings tab:

1. Enter your **name**, **role**, and a short **pitch** (1–2 sentences)
2. Add your **target companies** (one per line)
3. Review / edit the **message templates**
4. Click **Save settings** — you're ready

---

## How to Use

### Single send (Compose tab)
1. Open a person's LinkedIn profile
2. Click the Nudge icon → **Compose**
3. Pick a company + template (or write your own)
4. Click **Auto-fill & send** — or **Type only** to review first

### Bulk queue (Queue tab)
1. Set your message in Compose
2. Go to **Queue**, paste one profile URL per line
3. Click **Start queue** — runs in a background tab, your current tab stays free
4. Watch the live log + progress bar; toolbar badge shows count remaining
5. Hit **Stop** anytime — background tab closes automatically when done

### Connect requests
Write your note in the message box (max 300 chars), then click **＋ Connect**.

---

## Placeholders

| Placeholder | Source |
|---|---|
| `{first_name}` | Scraped from recipient's profile at send time |
| `{name}` | Scraped from recipient's profile |
| `{headline}` | Scraped from recipient's profile |
| `{company}` | Your selected target company (falls back to recipient's company) |
| `{role}` | Your Settings |
| `{pitch}` | Your Settings |
| `{uni}` | Your Settings |
| `{year}` | Your Settings |
| `{github}` | Your Settings |

---

## Safety

> **LinkedIn's ToS prohibits automated messaging.** Use conservatively, on your own account, at your own risk.

- Default cap: **10 messages/day** (LinkedIn flags accounts sending 20+/day)
- Randomised delays between bulk sends (default 25–60s)
- Deduplication by URL — skips profiles you've already messaged
- Connect requests count toward the same daily cap

---

## Tech Stack

- Manifest V3 Chrome Extension
- Vanilla JS — no dependencies, no build step
- `chrome.storage.local` for all persistence
- Service worker background script for queue processing + daily counter

---

## File Structure

```
├── manifest.json     # MV3 config
├── popup.html        # Tabbed UI
├── popup.js          # UI logic, single send, queue control, settings/history
├── background.js     # Service worker: daily counter + bulk queue processor
├── content.js        # Page scraping + message/connect automation
├── icons/            # Toolbar icons (16 / 48 / 128 px)
└── README.txt        # Quick-start guide
```

---

## License

MIT — free to use, modify, and share.
