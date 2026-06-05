'use strict';

// eliis.eu JSON API client (main process). Auth is the logged-in session cookie
// from the embedded browser — we just reuse that session with useSessionCookies.
//
// Discovery walks the date-windowed guardian feed:
//   GET /api/kindergartens/{kg}/children/{child}/guardian-feed?date=YYYY-MM-DD
// returns ~a few days ending at `date` plus `next_date` for the previous window.
// Media (full-resolution /diary/ URLs) is in data[].diaries[].texts[].images[]
// (and .documents[] for non-image files like videos).

const ORIGIN = 'https://eliis.eu';
const API = 'https://api.eliis.eu/api';

const sani = (s) => (s || '').replace(/[\/\\:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);

function stripHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}

// "2026-05-31 09:36:34.518" -> "20260531_093634" (drives filename + captureDate)
function tsFromUploaded(s) {
  const m = (s || '').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  return m ? `${m[1]}${m[2]}${m[3]}_${m[4]}${m[5]}${m[6]}` : '';
}

function apiGet(sess, url) {
  const { net } = require('electron');
  return new Promise((resolve, reject) => {
    const req = net.request({ url, session: sess, useSessionCookies: true });
    req.setHeader('Accept', 'application/json, text/plain, */*');
    req.setHeader('X-Requested-With', 'XMLHttpRequest');
    req.setHeader('Origin', ORIGIN);
    req.setHeader('Referer', ORIGIN + '/');
    const chunks = [];
    req.on('response', (res) => {
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function apiGetJson(sess, url) {
  const r = await apiGet(sess, url);
  if (r.status !== 200) {
    const err = new Error(`HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return JSON.parse(r.body);
}

// True if the session is logged in (common/init returns 200).
async function isAuthed(sess) {
  try { await apiGetJson(sess, `${API}/common/init`); return true; }
  catch (e) { return false; }
}

// List the guardian's children (with their kindergarten) for the picker.
async function getChildren(sess) {
  const init = await apiGetJson(sess, `${API}/common/init`);
  const kgName = {};
  for (const k of init.kindergartens || []) kgName[k.id] = k.name;
  return {
    user: init.user || null,
    children: (init.children || []).map((c) => ({
      id: c.id,
      kindergartenId: c.kindergarten_id,
      name: c.name,
      kindergarten: kgName[c.kindergarten_id] || '',
    })),
  };
}

// Extract raw media items (matching the download pipeline's shape, minus index)
// from one guardian-feed window.
function itemsFromFeed(feed) {
  const items = [];
  for (const day of feed.data || []) {
    for (const diary of day.diaries || []) {
      const group = diary.course || 'Eliis';
      const entryTitle = `Päevakirjeldus - ${group}`;
      const description = (diary.texts || [])
        .flatMap((t) => (t.summaries || []).map((s) => stripHtml(s.comment)))
        .filter(Boolean).join('\n\n');
      const folder = sani(`${day.date} ${group}`);
      for (const t of diary.texts || []) {
        const media = [...(t.images || []), ...(t.documents || [])];
        for (const m of media) {
          if (!m || !m.url) continue;
          const ts = tsFromUploaded(m.uploaded_at);
          const hash6 = String(m.filename || '').replace(/\.[^.]*$/, '').slice(0, 6);
          const title = [ts, hash6].filter(Boolean).join('_') || `media_${m.id}`;
          items.push({
            url: m.url,
            title,
            date: day.date,
            group,
            entryTitle,
            description,
            folder,
            isVideo: String(m.mime_type || '').startsWith('video'),
          });
        }
      }
    }
  }
  return items;
}

// Walk the feed backwards in time, handing each window's items to onItems.
async function crawlFeed({ sess, kindergartenId, childId, onItems, shouldStop }) {
  const base = `${API}/kindergartens/${kindergartenId}/children/${childId}/guardian-feed`;
  let date = new Date().toISOString().slice(0, 10);
  const seen = new Set();
  let total = 0;
  while (date && !seen.has(date)) {
    if (shouldStop && shouldStop()) return { stopped: true, total };
    seen.add(date);
    const feed = await apiGetJson(sess, `${base}?date=${date}`);
    const items = itemsFromFeed(feed);
    if (items.length) { total += items.length; onItems(items); }
    date = feed.next_date || null;
  }
  return { stopped: false, total };
}

module.exports = { isAuthed, getChildren, crawlFeed };
