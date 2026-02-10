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

## Development
- Install dependencies: `npm install` (optional)
- Lint: `npm run lint`
- Auto-fix lint issues: `npm run lint:fix`
- Format code: `npm run format`

> Note: I added lint and format configs (ESLint + Prettier). If you want, I can run `npm install` locally and install devDependencies — just say the word.

## License
This project is licensed under the MIT License. See the `LICENSE` file for details.