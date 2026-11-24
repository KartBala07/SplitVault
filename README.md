# SplitVault

Two four-digit keys, two full-screen phone apps, one static site.

| Key | Opens | What it is |
|---|---|---|
| **1857** | `games.html` | **Setup Rush** — the hold-to-ride trading game on the recorded 15-minute candles, designed for a phone and nothing else. |
| **1936** | `insta.html` | **Instagram in place** — public profiles and single posts load inside the app, in the same window. |

Live: **https://kartbala07.github.io/SplitVault/**

## Run it

Published build: open the link above, or add it to your home screen (it ships a manifest with
`display: standalone`, so it opens without browser chrome).

Locally:

```bash
node server.mjs              # http://127.0.0.1:8795
HOST=0.0.0.0 node server.mjs # then open your Mac's LAN IP on the phone
```

## Publish

Pages is served from the `gh-pages` branch, which holds the **contents of `public/`** — pushed with
`git subtree`, so no GitHub Actions and no workflow scope are involved:

```bash
git subtree push --prefix public origin gh-pages
```

## Mobile-native, on purpose

- One 100dvh screen per app. No nav tabs, no option grids, no dashboard — the gate, the game and the
  Instagram view each take the whole screen.
- Safe-area padding top and bottom (`env(safe-area-inset-*)`), `viewport-fit=cover`, `user-scalable=no`
  on the game (its chart is the control surface), 44px+ tap targets, no hover-only affordances.
- The Setup Rush chart is the touch surface: press to open long, pull down past 70px to flip short,
  release to cash out. HUD lives in HTML above/below the canvas, not painted into it.
- One orange primary action per screen; everything else is paper with an ink border.

## Setup Rush

A faithful port of the SetupRush iOS app's core loop on the app's own recorded data
(`public/assets/markets.json`, 8 crypto markets at 15-minute granularity):

- `notional = max(500, equity) × leverage`, `pnl = notional × dir × (exit − entry) / entry`,
  0.04% fee per side, `equity = bank + unrealized`.
- Candle printing follows the recorded OHLC path (`O → L/H → H/L → C`), 1.5s per bar.
- PRO table: 25×, long and short, 60-second clock or end of tape.
- Pattern setups draw entry, stop and 2R target lines, labelled `SETUP / STOP / 2R TARGET` so they are
  never confused with your own fill.
- A run ends at the clock or when the tape runs out; the sheet reports P&L, trades, win rate, best trade.

## Instagram, in place — and what that honestly means

Instagram answers `x-frame-options: DENY`, so `instagram.com` itself cannot be framed by any site. Its
**embed endpoints** can:

- `instagram.com/<user>/embed/` → a public profile
- `instagram.com/p/<code>/embed/`, `/reel/<code>/embed/`, `/tv/<code>/embed/` → one post

The app rewrites what you type to those URLs and loads them in the frame — same window, real Instagram
markup, your own session. Login-walled paths (`/explore`, `/direct`, `/stories`, `/reels`) show an
explicit notice instead of a blank frame.

The signed-in feed, DMs and Stories cannot be shown in place by any website: the page is a 541 KB
JS-only shell, its bytes refuse framing, and its API rejects unauthenticated calls. Nothing here proxies
Instagram or asks for an Instagram password.

## The key gate

This is a static site, so the gate runs in the browser:

- `index.html` is a numeric keypad; the four digits are compared as SHA-256 hashes in `assets/gate.js`.
- Unlocking sets `sessionStorage.sv.room`, and `games.html` / `insta.html` bounce to the keypad
  without it. Each key only opens its own room.
- **It is a door, not a vault.** Four digits is 10,000 possibilities and the hashes ship in the JS, so
  anyone who wants in can brute-force it in a second. Change the hashes in `assets/gate.js` if you want
  different keys — `shasum -a 256` on the new digits gives you the value.

## Design

Cream paper (`--paper`), ink borders (2px), hard offset shadows (`3px 3px 0`), one orange primary
action (`--accent`). Tokens live at the top of `public/app.css`; every screen reads them.

## Files

```
public/index.html            keypad gate
public/games.html            Setup Rush, full screen
public/insta.html            Instagram frame, full screen
public/app.css               the whole design layer
public/manifest.webmanifest  standalone install
public/assets/gate.js        key hashes + keypad
public/assets/games.js       boot + room guard
public/assets/insta.js       handle/link → embed URL
public/assets/setuprush.js   engine, chart, HUD
public/assets/markets.json   recorded candles (8 markets, 15m)
server.mjs                   zero-dep local preview server
```
