# spectral-drift

> A generative‑art piece that renders the interference pattern of many drifting wave sources — and, hidden inside the same page, an optional end‑to‑end‑encrypted peer‑to‑peer chat.

**Stack:** static HTML + p5.js (art) + a client‑side crypto/chat script · **Build step:** none · **Backend:** none (peer‑to‑peer)

Loosely part of the [lucafchala.com ecosystem](https://github.com/lucafchala/lucafchala.com#the-ecosystem); it has its **own** look, not the shared design system.

---

## What it is

**One sentence:** `spectral-drift` is a static, single‑page p5.js sketch that visualizes wave interference distorted by an evolving turbulence field, with a concealed, serverless, end‑to‑end‑encrypted chat that activates only on a secret gesture.

**In a paragraph:** The visible product is generative art. Multiple wave emitters radiate outward; where their fronts align, warm peaks bloom, where they cancel, cool troughs pool, and a slowly‑evolving Perlin‑noise field makes the whole geometry "breathe." A seed fixes the emitter positions, so every seed is a different landscape; sliders control the physics (number of sources, frequency, speed, turbulence, resolution) and you can export a PNG. Bundled in the same file is a second, unrelated feature: a hidden chat (`_w.js`) that, once unlocked, establishes an encrypted peer‑to‑peer channel over public [Gun.js](https://gun.eco) relays. It uses ephemeral ECDH (P‑384) + AES‑GCM with HMAC‑derived, time‑rotating channel IDs; the relays only ever see ciphertext. The art works with the chat code dormant — most visitors will never know it's there.

---

## Architecture

```
index.html  ──loads──►  p5.js (CDN)            → renders the interference canvas
            ──loads──►  _w.js (local script)    → dormant until a secret activation gesture
                              │
                              └─ on activation: loads Gun.js + QRCode (CDN), then
                                 ECDH P-384 key exchange → AES-GCM messages over Gun.js relays
                                 (channel id rotates every 6h via HMAC-SHA256; msgs expire ~12h)
```

- **`index.html`** — static page. Inline HTML/CSS/JS plus the p5.js sketch; controls in a sidebar; injects `_w.js` before `</body>`.
- **`_w.js`** — **runs in the browser**, despite the Worker‑looking filename. It is a self‑invoking script, *not* a Cloudflare Worker (no `export default { fetch }`). It implements the hidden chat entirely client‑side.
- **No server of its own.** The chat's transport is public Gun.js relay peers (hardcoded); message storage is the Gun.js graph (ciphertext only). The room secret is generated client‑side and kept in `localStorage`.

> **Deployment note:** there is **no `wrangler.toml` and no `package.json`** in this repo. It is a pure static site — deploy `index.html` + `_w.js` to any static host (e.g. Cloudflare Pages). If you intend the `_w.js` filename to imply a Worker, that wiring does not exist here; treat it as a browser script.

---

## How to use

### The art

Open `index.html`. Use the sidebar to explore (defaults in parentheses):

| Control | Range | Default | Effect |
|---|---|---|---|
| Seed | integer | `12345` | Fixes emitter positions — every seed is a different geometry |
| Sources | 2–9 | `5` | Number of wave emitters (2–3 = clean bilateral; 8–9 = dense, crystalline) |
| Frequency | 0.005–0.04 | `0.015` | Spatial frequency of the fringes |
| Speed | 0.1–3.0 | `1.0` | Propagation speed (set to 0 to freeze the field) |
| Turbulence | 0–4.0 | `1.2` | Phase distortion (0 = perfect fringes; 3+ = atmospheric chaos) |
| Turbulence scale | 0.001–0.012 | `0.003` | Spatial scale of the noise field |
| Resolution | 2–10 px | `4` | Cell size (2 = sharp/slow; 8–10 = intentional pixelation) |

Plus a color picker, pause/resume, and **export PNG**.

### The hidden chat (optional)

Activated by a deliberate gesture (typing a keyword, or tapping the title repeatedly). Once active it shows an admin panel with a QR/shareable link; opening that link on a second device performs the key exchange and the two peers can exchange end‑to‑end‑encrypted messages. There is no account and no server to sign in to — the link *is* the shared secret. Channels rotate every 6 hours; messages older than ~12 hours are discarded.

---

## Prerequisites

- A modern browser.
- (Optional) a static server for local preview — `python3 -m http.server`, `npx serve`, or Live Server.
- Network access to the CDNs/relays the page uses (p5.js, Google Fonts; and, only if the chat is activated, Gun.js, QRCode, and the Gun.js relay peers).

There are **no environment variables, secrets, accounts, or bindings.**

## Install & deploy

```bash
git clone https://github.com/lucafchala/spectral-drift.git
cd spectral-drift
python3 -m http.server 8000        # open http://localhost:8000

# deploy: copy index.html + _w.js to any static host (e.g. Cloudflare Pages)
```

---

## File structure

```
.
├── index.html    # Static page — p5.js interference-pattern art + sidebar controls; injects _w.js
├── _w.js         # Browser-side hidden P2P E2E chat (Gun.js relays, ECDH P-384 + AES-GCM). NOT a Worker.
└── README.md     # This file
```

---

## Design

`spectral-drift` does **not** use the [shared ecosystem design system](https://github.com/lucafchala/lucafchala.com#design-system). It has its own light UI:

- **Fonts:** *Lora* (title) + *Poppins* (UI) from Google Fonts; *Courier New* for numeric readouts.
- **Palette (CSS variables named `--anthropic-*` in source):** off‑white surface `#faf9f5` / near‑black `#141413`, warm peak `#d97757`, cool trough `#6a9bcc`, with an `#0d0c0b` default canvas background. Sidebar uses translucent white + backdrop blur.

The warm‑peak / cool‑trough colors double as the art's default peak/trough mapping.

---

## Technical decisions

- **Everything client‑side.** The art needs no server, and the chat is deliberately serverless (public Gun.js relays + client crypto) so there's nothing to host, log, or trust beyond the peers themselves.
- **Seed‑driven art.** Fixing emitter positions from a seed makes every render reproducible and shareable by a single number.
- **One file, two purposes.** The chat is bundled with the art and dormant by default; it costs nothing until the activation gesture loads its dependencies.

## Status

**Functional as a static page.** The art is self‑contained; the chat depends on third‑party Gun.js relay availability. No deploy config is committed — host the static files anywhere.
