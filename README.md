# Twitter Extension

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A simple Chrome extension for Twitter-related functionality.

## Badges

[![CI](https://github.com/nersi55/twitter-extention/actions/workflows/ci.yml/badge.svg)](https://github.com/nersi55/twitter-extention/actions)

## Contents

- `manifest.json` — extension manifest
- `background.js` — background scripts
- `popup.html` / `popup.js` — popup UI and logic

## Features

- Small, focused Chrome extension for Twitter tasks
- Lightweight and easy to load as an unpacked extension

## Installation

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this repository folder

## Usage

- Click the extension icon to open the popup and use the provided tools.
- Replace assets in the `assets/` folder to change icons or screenshots.

## Local API Server (optional)

This extension can poll a local HTTP server to receive commands so you can trigger actions via simple URLs.

- Start the example server included with the repo:

```bash
npm install express
node local_command_server.js
```

- Trigger a "like 5" command for a list (URL must be URL-encoded):

```
http://127.0.0.1:6060/tw/like5tw/https%3A%2F%2Fx.com%2Fi%2Flists%2F1591905950507716608
```

- Other helper routes:
	- `/tw/repost5tw/:encodedUrl` — enqueue `repostList` (count 5)
	- `/tw/quote5tw/:encodedUrl` — enqueue `quoteList` (count 5)
	- `POST /enqueue` — enqueue a JSON command like `{ "action": "likeMany", "count": 3, "url": "https://x.com/.." }`

- The extension polls `http://127.0.0.1:6060/next` every 2s and forwards any queued command to the existing handlers (`likeMany`, `repostList`, `quoteList`).

If the background service worker appears inactive (MV3 workers may suspend), open the included control page and keep it open — it will poll and forward commands reliably:

```
chrome-extension://<extension-id>/control_page.html
```

Replace `<extension-id>` with your unpacked extension's ID (shown on chrome://extensions after loading the unpacked folder), or open `control_page.html` from the repo in a browser tab after loading the extension.

Security notes:
- Only run the local server on trusted machines. The example server does not authenticate requests.
- The extension only forwards commands it receives to internal handlers; be careful with automated actions to avoid violating site terms of service.


## Development

- Install dependencies: `npm install` (optional)
- Lint: `npm run lint`
- Auto-fix lint issues: `npm run lint:fix`
- Format code: `npm run format`

> Note: I added lint and format configs (ESLint + Prettier). If you want, I can run `npm install` locally and install devDependencies — just say the word.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.
