How to use — Custom Chrome Extension (Like / Repost / Quote automation)

Overview

This repository contains a browser extension and a small local command queue server that let you automate actions on X (formerly Twitter): liking, reposting, and quoting tweets. Use the popup or enqueue commands to the local server to run tasks in a browser profile where the extension is installed and you're logged in to X.

Files of interest

- `background.js` — main automation logic and message handler.
- `content_script.js` — bridge forwarding page <-> extension messages.
- `local_command_server.js` — small express server (default port 6060) for enqueuing commands.
- `popup.html`, `popup.js` — extension UI to start common tasks.
- `control_page.html`, `control_page.js` — alternative control interface.

Quick start

1) Install extension in Chrome/Edge (developer mode)
   - Open `chrome://extensions` → enable Developer Mode → "Load unpacked" → select this repository folder.
   - Make sure the extension has necessary permissions (it uses `scripting`, `tabs`, `storage`, `activeTab`).

2) Start the local command server (optional — used to queue commands from CLI or other scripts)

```bash
# from the repo root
node local_command_server.js
# default: http://127.0.0.1:6060
```

3) Open the browser profile where the extension is installed and log in to X (https://x.com).

Using the popup UI

- Click the extension icon and use the popup controls to run tasks like `Like`, `Like 5`, `Repost list`, and `Quote list`.
- The popup registers a temporary message listener and will show an alert with results when complete.

Using the local command server (recommended for automation)

Endpoints (local server)
- `POST /enqueue` — enqueue a command (JSON body).
- `GET  /queue` — current queue.
- `GET  /next` — pop next command (server consumer use).
- `GET  /history` — executed commands history.

Example `curl` commands

- Navigate to a page:

```bash
curl -X POST http://127.0.0.1:6060/enqueue \
  -H 'Content-Type: application/json' \
  -d '{"action":"navigate","url":"https://x.com"}'
```

- Click the first like/retweet icon on current page (simple test):

```bash
curl -X POST http://127.0.0.1:6060/enqueue \
  -H 'Content-Type: application/json' \
  -d '{"action":"click"}'
```

- Like many (example: like 5 tweets, 30s delay):

```bash
curl -X POST http://127.0.0.1:6060/enqueue \
  -H 'Content-Type: application/json' \
  -d '{"action":"likeMany","count":5,"delaySeconds":30}'
```

- Repost tweets from a list (list URL):

```bash
curl -X POST http://127.0.0.1:6060/enqueue \
  -H 'Content-Type: application/json' \
  -d '{"action":"repostList","url":"https://x.com/i/lists/1591905950507716608","count":5}'
```

- Quote tweets from a list with per-tweet messages

```bash
curl -X POST http://127.0.0.1:6060/enqueue \
  -H 'Content-Type: application/json' \
  -d '{"action":"quoteList","url":"https://x.com/i/lists/1591905950507716608","count":5,"messages":["Nice!","Great thread"]}'
```

Quoting a single post (fixed behavior)

- The extension now detects single-post URLs (those containing `/status/<id>`). For single-post requests it will:
  - Only target the main tweet on that page (ignore replies and other tweets)
  - Skip the action if the tweet was already quoted/retweeted
  - Not scroll the page
  - Force `count = 1` (you may omit `count`)

Example — quote a specific tweet (you can omit `count`):

```bash
curl -X POST http://127.0.0.1:6060/enqueue \
  -H 'Content-Type: application/json' \
  -d '{"action":"quoteList","url":"https://x.com/SomeUser/status/1234567890123456789","messages":["Nice!"]}'
```

### Auto-closing tabs

You can now use `closeDelayMinutes` to automatically close the tab after the task is finished.

```bash
# Close tab 2 minutes after finishing likeMany
curl -X POST http://127.0.0.1:6060/enqueue \
  -H 'Content-Type: application/json' \
  -d '{"action":"likeMany","count":5,"delaySeconds":10,"closeDelayMinutes":2}'
```

What the command does (single-post flow)
- Opens the specified URL in a new tab.
- Waits for the page to load and ensures the main `article` element is rendered.
- Checks for an element like `[data-testid="unretweet"]` or `aria-pressed="true"` to detect prior retweet/quote; if found it aborts and reports `alreadyQuoted: true`.
- If not already quoted, it clicks the retweet menu on the main tweet and selects the quote/repost option, fills the composer with the message, sets reply permissions (if prompted), and posts.

Result reporting

- The extension sends the result message back via `chrome.runtime.sendMessage` and also stores last results in `chrome.storage.local` keys such as `quoteListLastResult`, `repostListLastResult`, etc.
- The popup polls storage as a fallback to show results if the runtime message is missed.
- Alternatively, check the local command server `GET /history` to confirm the command was dequeued and executed.

Tips & troubleshooting

- Must be logged in to X in the browser profile where the extension is installed.
- If the composer doesn’t appear, the script logs a `Composer timeout`. Try increasing `delaySeconds` or manually verify the UI.
- If actions silently fail, open the extension background page (chrome://extensions → "background page" for the extension) to view console logs from `background.js`.
- Keep `delaySeconds` reasonable (default 30) to reduce automation detection.
- If X changes markup, selectors may break; inspect the page to update selectors in `background.js`.

Developer notes

- The automation uses `chrome.scripting.executeScript` with retries.
- The `quoteList` flow has two modes: list-mode (scans multiple tweets) and single-post mode (only the main tweet).
- Results are delivered by `deliverResult` which prefers `chrome.storage.local.set` then runtime messaging.

Next steps / customization ideas

- Add an option to force `count` for single-post pages (currently forced to 1 for safety).
- Add a `dry-run` flag to preview the candidate tweets without clicking.
- Add better selector fallbacks for future X UI updates.

Contact / feedback

If you find a bug or a case where quoting still picks multiple items for a single post, please file an issue and include the exact URL you used and the command you enqueued.

Install :
npm install express
node local_command_server.js



Qoute:

curl -X POST http://127.0.0.1:6060/enqueue \
  -H 'Content-Type: application/json' \
  -d '{"action":"quoteList","url":"https://x.com/KavehGhoreishi/status/2021520999746048145","count":1,"messages":["Nice!"]}'


Like 
curl -X POST http://127.0.0.1:6060/enqueue \
  -H 'Content-Type: application/json' \
  -d '{"action":"likeMany","url":"https://x.com/KavehGhoreishi/status/2021520999746048145","count":1,"delaySeconds":2,"keepTab":true}'
You can also add `"keepTab": true` to `repostList`, `quoteList`, or `replyList` commands when you need to keep the temporary tab open for debugging; leave it out or set it to `false` to let the extension close the tab automatically.
Repost

  curl -X POST http://127.0.0.1:6060/enqueue \
  -H 'Content-Type: application/json' \
  -d '{"action":"repostList","url":"https://x.com/KavehGhoreishi/status/2021520999746048145","count":1,"delaySeconds":2}'


Queue and history

curl -s http://127.0.0.1:6060/queue
curl -s http://127.0.0.1:6060/history
curl -i http://127.0.0.1:6060/next
