'use strict';

// Node port of downloader.py: shape raw discovery items into manifest items,
// then create the folder tree, .xmp sidecars, _diary.txt, and download the
// media concurrently with retry + resume. Runs in Electron's main process.

const fs = require('fs');
const path = require('path');

const CONCURRENCY = 6;
const RETRIES = 3;

function escapeXml(s) {
  return (s || '').replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c])
  );
}

function buildXmp(description, dateTime, tags) {
  let dateBlock = '';
  if (dateTime) {
    dateBlock =
      `\n   <exif:DateTimeOriginal>${dateTime}</exif:DateTimeOriginal>` +
      `\n   <photoshop:DateCreated>${dateTime}</photoshop:DateCreated>` +
      `\n   <xmp:CreateDate>${dateTime}</xmp:CreateDate>`;
  }
  const tagLis = (tags || []).map((t) => `<rdf:li>${escapeXml(t)}</rdf:li>`).join('');
  return (
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n' +
    ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
    '  <rdf:Description rdf:about=""\n' +
    '    xmlns:dc="http://purl.org/dc/elements/1.1/"\n' +
    '    xmlns:exif="http://ns.adobe.com/exif/1.0/"\n' +
    '    xmlns:xmp="http://ns.adobe.com/xap/1.0/"\n' +
    '    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/">\n' +
    `   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(description || '')}</rdf:li></rdf:Alt></dc:description>\n` +
    `   <dc:subject><rdf:Bag>${tagLis}</rdf:Bag></dc:subject>${dateBlock}\n` +
    '  </rdf:Description>\n' +
    ' </rdf:RDF>\n' +
    '</x:xmpmeta>\n' +
    '<?xpacket end="w"?>'
  );
}

const sani = (s) =>
  (s || '').replace(/[\/\\:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);

function capFromTitle(t) {
  const m = (t || '').match(/(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;
}

// One raw page item -> the manifest shape consumed by downloader.py and this
// module. Returns null for items without a resolved URL.
function shapeItem(p) {
  if (!p || !p.url) return null;
  const ext = (p.url.split('.').pop().split('?')[0] || 'jpg')
    .toLowerCase()
    .replace('jpeg', 'jpg')
    .slice(0, 4);
  const base = `${String(p.index).padStart(5, '0')}_${sani(p.title)}`;
  const captureDate =
    capFromTitle(p.title) ||
    (p.date && p.date !== 'undated' ? `${p.date}T12:00:00` : null);
  return {
    index: p.index,
    url: p.url,
    folder: p.folder,
    filename: `${base}.${ext}`,
    title: p.title,
    date: p.date,
    group: p.group,
    entryTitle: p.entryTitle,
    description: p.description,
    captureDate,
    tags: [p.group, 'Eliis'],
  };
}

// Raw page items -> manifest items (filtering out any without a URL).
function buildManifest(items) {
  return (items || []).map(shapeItem).filter(Boolean);
}

// The per-folder diary text (Estonian labels, matches downloader.py).
function diaryText(it) {
  return (
    `${it.entryTitle || ''}\n` +
    `Kuupäev / Date: ${it.date || ''}\n` +
    `Rühm / Group: ${it.group || ''}\n\n` +
    `${it.description || '(no text)'}\n`
  );
}

// Download one URL to dest using the shared (logged-in) session. Skips existing
// non-empty files so the whole run doubles as resume.
function fetchToFile(net, sess, url, dest) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return resolve('skip');

    let attempt = 0;
    const attemptOnce = () => {
      const req = net.request({ url, session: sess });
      req.setHeader('User-Agent', 'eliis-archiver/1.0');
      const chunks = [];
      req.on('response', (res) => {
        if (res.statusCode >= 400) {
          res.on('data', () => {});
          res.on('end', () => retryOrFail(new Error(`HTTP ${res.statusCode}`)));
          return;
        }
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (!buf.length) return retryOrFail(new Error('empty response'));
          try {
            const tmp = dest + '.part';
            fs.writeFileSync(tmp, buf);
            fs.renameSync(tmp, dest);
            resolve('ok');
          } catch (e) {
            retryOrFail(e);
          }
        });
      });
      req.on('error', (e) => retryOrFail(e));
      req.end();
    };

    const retryOrFail = (err) => {
      attempt += 1;
      if (attempt < RETRIES) setTimeout(attemptOnce, 1500 * attempt);
      else reject(err);
    };

    attemptOnce();
  });
}

async function runDownload(items, outDir, sess, onProgress, shouldStop) {
  const { net } = require('electron');
  const stop = () => (shouldStop ? shouldStop() : false);

  // 1) folders, sidecars, per-folder diary text (fast, local)
  const diaryWritten = new Set();
  for (const it of items) {
    const folder = path.join(outDir, it.folder);
    fs.mkdirSync(folder, { recursive: true });

    if (!diaryWritten.has(it.folder)) {
      diaryWritten.add(it.folder);
      fs.writeFileSync(path.join(folder, '_diary.txt'), diaryText(it));
    }

    fs.writeFileSync(
      path.join(folder, it.filename + '.xmp'),
      buildXmp(it.description, it.captureDate, it.tags)
    );
  }

  // 2) parallel downloads with retry + resume
  const total = items.length;
  let ok = 0;
  let skip = 0;
  let fail = 0;
  let done = 0;
  const queue = items.slice();

  const worker = async () => {
    while (queue.length) {
      if (stop()) return; // pause: stop pulling new work; in-flight files finish
      const it = queue.shift();
      const dest = path.join(outDir, it.folder, it.filename);
      try {
        const r = await fetchToFile(net, sess, it.url, dest);
        if (r === 'ok') ok += 1;
        else skip += 1;
      } catch (e) {
        fail += 1;
      }
      done += 1;
      if (onProgress) onProgress({ done, total, ok, skip, fail });
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { ok, skip, fail, total, stopped: stop() };
}

module.exports = { buildXmp, shapeItem, buildManifest, diaryText, fetchToFile, runDownload };
