# naksid-eliis-pildid — Eliis Archiver

A standalone desktop app that archives a child's [Eliis](https://eliis.eu/)
kindergarten diary — photos, videos, and the diary text — into a local,
[Immich](https://immich.app/)-ready folder tree.

Eliis has no bulk export and no public API, so the app embeds a real Chromium
browser: you log into Eliis inside it, open a child's diary, and it drives the
page to discover every photo/video (resolving the true full-resolution URLs),
then downloads and organizes them — one folder per diary entry, with an `.xmp`
metadata sidecar per file and a `_diary.txt` per folder.

## Two steps: Index, then Download

The work is split into two independently controlled operations, each a
start/stop button in the sidebar:

1. **Index** — crawls the open diary and writes **metadata + links** to disk:
   `_diary.txt`, `.xmp` sidecars, the `eliis_manifest.json`, and a resumable
   state file. No media is downloaded yet.
2. **Download** — fetches the actual photo/video files for everything indexed.

They compose freely:

- **Index only** → a metadata-and-links archive with no images.
- **Index, then Download later** → fetch the files when you're ready.
- **Both at once** → a parallel pipeline: the downloader pulls files while the
  crawler keeps indexing.

Videos are always included.

## Install

Download the latest **`.dmg`** (macOS) or **`.exe`** (Windows) from the
[Releases](../../releases) page. The builds are unsigned, so on first launch:

- **macOS:** right-click the app → **Open** (or
  `xattr -dr com.apple.quarantine "/Applications/Eliis Archiver.app"`).
- **Windows:** **More info → Run anyway** on the SmartScreen prompt.

## Use

1. Launch **Eliis Archiver** — it opens on eliis.eu.
2. Log in and open the child's diary you want to archive.
3. Click **Vali sihtkoht** (Choose folder) and pick a destination.
4. Click **Indekseeri** (Index). Watch the **Leitud** (Discovered) count climb.
5. Click **Laadi alla** (Download) to fetch the files — or do this anytime, even
   while indexing is still running.

The sidebar shows live stats (discovered / downloaded / skipped / failed / queued
/ active) and a per-file activity feed. The UI is in **Estonian** by default;
switch to English with the language selector (top of the sidebar).

### Pause & resume — nothing is lost

State is streamed to `.eliis-archiver-state.json` inside your output folder as
each item is indexed. You can press **stop** on either operation — or quit, or
crash — at any time. Point the app at the same folder again and:

- **Re-indexing** skips photos it already read (no re-opening modals) and keeps
  filenames stable, while still picking up any new diary entries.
- **Downloading** skips files that already exist.

So re-running against the same folder is always safe and only does what's left.

## Import to Immich

The folder-per-entry layout maps one album per diary entry:

```bash
immich upload <your-output-folder> --recursive --album
```

## Develop / run from source

```bash
npm install
npm start        # or: npm run dev
```

> If it crashes immediately with `Cannot read properties of undefined (reading
> 'whenReady')`, the `ELECTRON_RUN_AS_NODE` env var is set in your shell. Run
> `ELECTRON_RUN_AS_NODE= npm start`.

## Build & release

GitHub Actions builds the installers and publishes them to a GitHub Release when
you push a version tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The [workflow](.github/workflows/build.yml) builds on macOS and Windows runners
and uploads the `.dmg`/`.exe`. Manual `workflow_dispatch` runs build the
installers as downloadable artifacts without publishing. To build locally:
`npm run dist`.

> First-time setup: in [package.json](package.json) set the `repository` field's
> `OWNER` to your GitHub account (CI infers it automatically; a local
> `npm run dist:publish` needs it).

## On-disk output

```
<output folder>/
  eliis_manifest.json            # full index: links + metadata for every item
  .eliis-archiver-state.json     # resume state (safe to delete to start fresh)
  2026-05-28 Naksitrallid/
    _diary.txt                   # entry title, date, group, diary text
    00000_20260528_102719.jpg
    00000_20260528_102719.jpg.xmp   # description, capture date, tags
    ...
```

## Known limitation: hardware passkeys

The embedded Chromium **cannot use hardware passkeys / WebAuthn** — the OS only
exposes those to real, registered browsers. If your Eliis account requires a
physical security key, use another login method (Smart-ID, Mobile-ID, ID-card, or
Google) inside the app window.

## Architecture

See [CLAUDE.md](CLAUDE.md) for how the pieces fit (embedded browser, injected
crawler, streaming download manager, IPC).
