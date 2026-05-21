# KSE Index Viewer — Web

A mobile-first PWA companion to the [KSE Index Viewer desktop widget](../kse-tauri). Live PSX indices, full searchable market-watch, per-stock charts, and the same Google-Sheet-backed portfolio tracking — accessible from any browser, installable on Android/iOS as an app.

![Platform](https://img.shields.io/badge/host-Cloudflare%20Pages-orange) ![Tech](https://img.shields.io/badge/stack-Vanilla%20JS%20%2B%20Pico-blue) ![PWA](https://img.shields.io/badge/PWA-installable-green)

## Why this exists

The desktop app is Windows-only and tied to a 280×500 widget on your taskbar. The web app extends the same idea to phones and any OS — without an install. It is **standalone**: it shares no code with the desktop app, but reuses the same Apps Script Web App pattern so anyone who already configured their portfolio sheet for the desktop can paste the same URL here and see the same data.

## Architecture

```
                 Browser (PWA, installable)
                 │
       ┌─────────┴───────────┐
       │                     │
  /api/* fetch          fetch direct (CORS ok)
       │                     │
       ▼                     ▼
 Pages Functions     User's Apps Script Web App ──▶ User's Google Sheet
 (proxy PSX HTML)
       │
       ▼
 dps.psx.com.pk
```

- **Frontend:** vanilla JS + [PicoCSS](https://picocss.com/) + [uPlot](https://github.com/leeoniya/uPlot) for charts. No build step. Just static files served by Cloudflare Pages.
- **Backend:** Cloudflare Pages Functions (Workers embedded in the Pages project). Four endpoints scrape PSX and return JSON with CORS headers and 30–60 s edge caching:
  - `GET /api/indices` — live PSX indices
  - `GET /api/market-watch` — full ~470-stock table
  - `GET /api/stock/:symbol` — single stock quote + intraday data
  - `GET /api/symbols` — symbol list (for autocomplete)
- **Portfolio storage:** the user's own Google Sheet, reached via the Apps Script Web App URL they paste into Settings. No bundled credentials, no OAuth, no backend database.

## Features

| Page | What it does |
|---|---|
| **Indices** | Cards for each PSX index with current value + today's change |
| **Market** | Full sortable, searchable list of every stock with sector filter |
| **Stock detail** | Quote header + intraday chart + key stats (LDCP, day high/low, 52w, volume) — tap any symbol anywhere to drill in |
| **Portfolio** | Totals card + per-holding cards (avg cost, current worth, unrealized P&L, today's change, realized P&L from partial sells). Sortable. |
| **Settings** | Apps Script URL + default page + refresh interval. "Copy Apps Script code" button. |

Plus:

- Works offline (service worker caches the shell and last API responses)
- Installable as a PWA (Chrome → "Install app", or iOS → "Add to Home Screen")
- Dark theme by default
- Mobile-first responsive layout

## Portfolio setup (one-time)

If you already configured the desktop app's portfolio, **paste that same Apps Script Web App URL into the web app's Settings** — it works as-is.

If not, the web app's Settings page has a **"Copy Apps Script code"** button and a built-in walkthrough. The flow is:

1. Create a new blank Google Sheet
2. Extensions → Apps Script — paste the copied code → Save
3. Deploy → New deployment → Type: Web app · Execute as: **Me** · Who has access: **Anyone** → Deploy
4. Authorize the script when prompted (it only touches the sheet it was created in)
5. Copy the Web App URL → paste into the web app's Settings → Save

You can review the script before deploying — it's 30 lines, only reads and appends to the `Transactions` sheet.

## Why a Google Sheet?

Same reason as the desktop app: this is a free hobby project, and the alternatives are worse:

| Option | Why not |
|---|---|
| Local storage only | Dies when the user clears site data. No cross-device sync. |
| Hosted cloud database | Costs money to run, and asks users to trust a stranger with trade data. |
| Google OAuth flow | Requires shipping an OAuth client ID + secret in the app and asking users for full Drive access. Heavy and creepy. |
| **Apps Script Web App** ✅ | User owns the sheet and the auth. Zero credentials shipped in the app. Same flow works on web and desktop, so data stays in sync between both. |

## Local development

Requires Node 18+ for `wrangler`.

```bash
cd web
npm install
npm run dev   # serves at http://localhost:8788
```

`npm run dev` runs `wrangler pages dev public` — both the static frontend and the `/api/*` functions run together. Edit any file → reload the browser.

### Sanity-check the API endpoints

```bash
curl http://localhost:8788/api/indices              | head -c 400
curl http://localhost:8788/api/market-watch         | head -c 400
curl http://localhost:8788/api/stock/HBL            | head -c 400
curl http://localhost:8788/api/symbols              | head -c 400
```

## Deploying to Cloudflare Pages

One-time setup (in the Cloudflare dashboard):

1. **Create a free Cloudflare account** (if you don't have one)
2. **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
3. Pick your `KSEIndexViewer` GitHub repo
4. Build settings:
   - **Production branch:** `main`
   - **Build command:** *(leave empty)*
   - **Build output directory:** `web/public`
   - **Root directory:** `web`
5. Click **Save and Deploy**

Cloudflare builds and deploys in ~30 seconds. Your URL will be something like `https://kse-index-viewer.pages.dev`.

After the first deploy:

- **`web/public/*`** is served as static files
- **`web/functions/api/*`** is auto-routed as `/api/*` endpoints (no extra config)
- Every push to `main` triggers a rebuild — no CLI commands needed

### Optional: deploy from the CLI

If you'd rather skip the Git connection:

```bash
cd web
npx wrangler pages deploy public --project-name=kse-index-viewer
```

This requires logging in once (`npx wrangler login`).

## File layout

```
web/
├── public/
│   ├── index.html              # SPA shell
│   ├── manifest.webmanifest    # PWA manifest
│   ├── sw.js                   # Service worker
│   ├── icons/                  # PWA icons
│   ├── css/app.css             # Custom dark theme on top of Pico
│   └── js/
│       ├── app.js              # Hash router + bootstrap
│       ├── api.js              # /api wrapper + Apps Script client + portfolio math
│       ├── store.js            # localStorage helpers
│       ├── format.js           # Number formatters
│       └── pages/
│           ├── indices.js
│           ├── market.js
│           ├── portfolio.js
│           ├── stock.js
│           └── settings.js
├── functions/
│   └── api/
│       ├── _psx.js             # Shared PSX scraping helpers
│       ├── indices.js
│       ├── market-watch.js
│       ├── symbols.js
│       └── stock/[symbol].js
├── package.json
└── wrangler.toml
```

## Limitations

- Cloudflare Pages free tier: 100k function requests/day, 500 deploys/month. Plenty for personal use; if it ever becomes a problem, the cache TTLs can be raised.
- PSX HTML structure could change at any time — the scraper uses stable `data-*` attributes where available (notably `data-search` for symbol cells to handle XD/XB badges), which is more robust than text-only selectors. If PSX changes, both the desktop Rust scraper and these JS functions need updating in tandem.
- The Apps Script Web App URL is treated as a shared secret — anyone with the URL can read/write that sheet. Treat it like a Dropbox share link. You can rotate it any time from Apps Script → Deploy → Manage deployments.

## License

MIT
