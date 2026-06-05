'use strict';

// Streaming pipeline shared by two independently controlled operations:
//   - Indexing (the crawler) calls enqueue() with discovered items. This always
//     writes the folder, _diary.txt and .xmp sidecar, and records the item for
//     the manifest — i.e. metadata + links land on disk even if nothing is
//     downloaded. Items are also placed on the download queue.
//   - Downloading is toggled with setDownloading(). Only while it is active does
//     the worker pool drain the queue and fetch the actual media. So you can
//     index without downloading, download without indexing, or do both at once.

const fs = require('fs');
const path = require('path');
const { buildXmp, shapeItem, diaryText, fetchToFile } = require('./download');

const CONCURRENCY = 6;
const MANIFEST_THROTTLE_MS = 3000;

class DownloadManager {
  constructor({ outDir, sess, sender }) {
    this.outDir = outDir;
    this.sess = sess;
    this.sender = sender;

    this.queue = [];
    this.inFlight = 0;
    this.downloadActive = false;

    this.ok = 0;
    this.skip = 0;
    this.fail = 0;
    this.allItems = [];          // shaped items, for the manifest
    this.seen = new Set();       // dedup by URL across re-enqueues
    this.diaryWritten = new Set();
    this._lastManifest = 0;
  }

  // Index step: record metadata + sidecars and queue the media (download happens
  // only if/when downloading is active).
  enqueue(rawItems) {
    for (const raw of rawItems || []) {
      const it = shapeItem(raw);
      if (!it || this.seen.has(it.url)) continue;
      this.seen.add(it.url);
      this.allItems.push(it);
      try {
        const folder = path.join(this.outDir, it.folder);
        fs.mkdirSync(folder, { recursive: true });
        if (!this.diaryWritten.has(it.folder)) {
          this.diaryWritten.add(it.folder);
          fs.writeFileSync(path.join(folder, '_diary.txt'), diaryText(it));
        }
        fs.writeFileSync(
          path.join(folder, it.filename + '.xmp'),
          buildXmp(it.description, it.captureDate, it.tags)
        );
      } catch (e) { /* sidecar errors shouldn't abort the run */ }
      this.queue.push(it);
    }
    if (Date.now() - this._lastManifest > MANIFEST_THROTTLE_MS) this.writeManifest();
    this.pump();
  }

  setDownloading(active) {
    this.downloadActive = active;
    this.pump();
    this._emitProgress();
  }

  pump() {
    const { net } = require('electron');
    while (this.downloadActive && this.inFlight < CONCURRENCY && this.queue.length) {
      const it = this.queue.shift();
      this.inFlight += 1;
      const dest = path.join(this.outDir, it.folder, it.filename);
      fetchToFile(net, this.sess, it.url, dest)
        .then((r) => { if (r === 'ok') this.ok += 1; else this.skip += 1; this._emitItem(it, r); })
        .catch(() => { this.fail += 1; this._emitItem(it, 'fail'); })
        .finally(() => { this.inFlight -= 1; this._emitProgress(); this.pump(); });
    }
    if (this.downloadActive && !this.queue.length && this.inFlight === 0) this.writeManifest();
    this._emitProgress();
  }

  writeManifest() {
    this._lastManifest = Date.now();
    try {
      const manifest = {
        rootFolder: path.basename(this.outDir),
        generatedAt: new Date().toISOString(),
        count: this.allItems.length,
        items: this.allItems,
      };
      fs.writeFileSync(
        path.join(this.outDir, 'eliis_manifest.json'),
        JSON.stringify(manifest, null, 2)
      );
    } catch (e) { /* ignore */ }
  }

  _emitProgress() {
    if (this.sender.isDestroyed()) return;
    this.sender.send('download-progress', {
      ok: this.ok, skip: this.skip, fail: this.fail,
      inFlight: this.inFlight, queued: this.queue.length,
      downloaded: this.ok + this.skip + this.fail,
      total: this.allItems.length,
      downloading: this.downloadActive,
    });
  }

  _emitItem(it, status) {
    if (this.sender.isDestroyed()) return;
    this.sender.send('download-item', { filename: it.filename, folder: it.folder, status });
  }
}

module.exports = { DownloadManager };
