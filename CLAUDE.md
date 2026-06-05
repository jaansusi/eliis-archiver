# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this repo is

**Eliis Archiver** — an Electron desktop app (Chromium + Node) that archives a
child's Eliis kindergarten diary (photos, videos, diary text) into a local,
Immich-ready folder tree. The whole project is this one app at the repo root;
there is no separate backend and no Python. (Earlier versions had standalone
`scraper.js` / `downloader.py` scripts — those have been removed; the app is now
the only path.)

## Why an embedded browser

Eliis has no bulk export and no public API. The only way to get the media is to
drive the **logged-in Eliis web page**: expand all days/galleries, open each
photo's modal to read the true full-resolution `/diary/` URL (thumbnails carry a
different, underivable hash), and scrape each entry's date, group, and diary text.
The app embeds a real Chromium (`<webview>`) so the user logs in normally and we
inject a crawler into that page. The media URLs are on public CloudFront, but
downloads reuse the logged-in session anyway (so cookie-gated media also works).

## Two operations (the core model)

Indexing and downloading are **separate, independently toggled** operations that
share one streaming pipeline:

- **Index** (crawl): resolves item URLs + metadata and writes them to disk
  immediately — `_diary.txt`, `.xmp` sidecars, `eliis_manifest.json`, and the
  resume state file. Indexing alone = a metadata-and-links archive, no media.
- **Download**: drains the queue of indexed items and fetches the actual files.

They run in any combination: index-only, download-later, or both at once
(producer/consumer in parallel). Videos are always included — there is no toggle.

## Layout

- [package.json](package.json) — Electron + electron-builder config. `main` is
  `src/main.js`; build config is the `build` key.
- `src/main.js` — main process: window, IPC, the persistent `persist:eliis`
  session, and the lifecycle of the `DownloadManager`.
- `src/preload.js` — `contextBridge` API exposed to the renderer.
- `src/renderer/` — the UI:
  - `index.html` — sidebar (settings, progress, activity) + browser pane (nav +
    `<webview>`).
  - `renderer.js` — orchestration: the two start/stop toggles, the
    crawler→pipeline item stream, progress/activity rendering, completion logic.
  - `i18n.js` — tiny i18n; **Estonian default**, English fallback. Static nodes
    use `data-i18n` / `data-i18n-title`; dynamic strings go through `t()`.
  - `styles.css`.
- `src/inject/discover.js` — the crawler injected into the Eliis page via
  `webview.executeJavaScript`. An anonymous async function expression that emits
  each newly resolved item over the console as `__ARCH_ITEM__{json}`, emits
  progress as `__ARCH__{json}`, honors `window.__eliisStop` to pause, and returns
  the items array.
- `src/download.js` — pure helpers: `shapeItem` (raw → manifest item), `buildXmp`,
  `diaryText`, `fetchToFile` (retry + resume), plus `buildManifest`/`runDownload`.
- `src/downloadManager.js` — the streaming pipeline. `enqueue()` writes
  sidecars/diary + records the item + queues it; `setDownloading(bool)` toggles
  the worker pool that drains the queue. Dedups by URL; writes the manifest
  (throttled + on idle).
- `src/state.js` — resume state in `<outDir>/.eliis-archiver-state.json`
  (atomic write, dedup by `folder|title`).
- [.github/workflows/build.yml](.github/workflows/build.yml) — builds + publishes
  `.dmg`/`.exe` on a `v*` tag.

## Data flow

1. Renderer injects `src/inject/discover.js` into the `<webview>` with any `known`
   items (from state) so resume skips already-read photos and keeps indices stable.
2. The crawler streams `__ARCH_ITEM__` messages; the renderer batches them and
   calls `index-enqueue` (IPC).
3. `index-enqueue` persists to state (`src/state.js`) and hands the batch to the
   `DownloadManager`, which writes sidecars and queues the media.
4. **Download** (`download-start`) flips the manager's worker pool on; it fetches
   queued items in parallel with ongoing indexing. `download-stop` flips it off.
5. The manager emits `download-progress` / `download-item`; the renderer updates
   the sidebar stats and activity feed and detects completion (download on,
   indexing off, queue empty, nothing in flight).

## Key invariants — keep these

- **Idempotent / resumable.** Existing non-empty files are skipped; indexing
  reuses known items and keeps the `index`-derived filename stable (so a later
  run doesn't re-download under a new name). Don't break this.
- **Metadata before media.** Sidecars/diary/manifest are written at *index* time,
  not download time — that's what makes index-only mode useful. Don't move them
  into the download path.
- **State is streamed, never batched-at-end.** Each indexed item must be persisted
  as it's found so a stop/quit/crash loses nothing.
- **Crawler is DOM-coupled.** The selectors in `src/inject/discover.js`
  (`.card`, `.e3-folder-container`, `#view-media-file-modal`, Estonian button text
  like "vaata vanemaid", "pildid", "kuva rohkem") track the live Eliis DOM and
  **cannot be verified from this repo**. Treat changes here carefully.
- **UTF-8 / Estonian.** Diary and XMP text is Estonian — preserve encoding and the
  `escapeXml` usage in `src/download.js`.
- **Private family data.** Never commit, upload, or send diary text, media, or
  manifests to any external service.

## Running & testing

```bash
npm install && npm start        # npm run dev is an alias
```

- The app needs an interactive login (and, in this sandbox, a display), so it
  **cannot be exercised end-to-end headlessly** — `npm start` boots but you can't
  log in. Verify code with `node --check src/**/*.js` and unit-style Node scripts:
  `src/download.js` helpers are pure; `src/downloadManager.js` can be driven by
  stubbing `require('electron').net` (see git history for an example test).
- **Gotcha:** if Electron crashes with `Cannot read properties of undefined
  (reading 'whenReady')`, the shell has `ELECTRON_RUN_AS_NODE=1` set (it leaks
  from some IDE/agent shells). Launch with `env -u ELECTRON_RUN_AS_NODE`.

## Known limitation

The embedded Chromium can't use hardware passkeys / WebAuthn (the OS only exposes
those to registered browsers). Users must log in with another Eliis method.
