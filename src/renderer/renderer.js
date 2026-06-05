'use strict';

const elOutDir = document.getElementById('outDir');
const elStatus = document.getElementById('status');
const elFill = document.getElementById('bar-fill');
const btnIndex = document.getElementById('btnIndex');
const btnDownload = document.getElementById('btnDownload');
const btnChoose = document.getElementById('choose');
const btnLogin = document.getElementById('login');
const selLang = document.getElementById('lang');
const selChild = document.getElementById('child');
const btnChildRefresh = document.getElementById('childRefresh');
const elActivity = document.getElementById('activity');
const stat = {
  discovered: document.getElementById('s-discovered'),
  downloaded: document.getElementById('s-downloaded'),
  skipped: document.getElementById('s-skipped'),
  failed: document.getElementById('s-failed'),
  queued: document.getElementById('s-queued'),
  active: document.getElementById('s-active'),
};
const t = window.i18n.t;

let outDir = null;
let indexing = false;
let downloading = false;
let totalIndexed = 0;
let childrenLoaded = false;
let authed = false;
let lastStatus = { key: 'status.initial', vars: null };

// ---- status / progress ------------------------------------------------------
function renderStatus() { elStatus.textContent = t(lastStatus.key, lastStatus.vars); }
function setStatus(key, vars) { lastStatus = { key, vars: vars || null }; renderStatus(); }
function setProgress(frac, done) {
  elFill.style.width = `${Math.max(0, Math.min(1, frac || 0)) * 100}%`;
  elFill.classList.toggle('done', !!done);
}
function resetStatGrid() {
  for (const k in stat) stat[k].textContent = '0';
  elActivity.innerHTML = '';
  setProgress(0);
}
function updateButtons() {
  const haveChild = !!selChild.value;
  btnIndex.disabled = !outDir || !haveChild;
  btnDownload.disabled = !outDir;
  btnChoose.disabled = indexing || downloading;
  selLang.disabled = indexing || downloading;
  selChild.disabled = indexing || downloading || !childrenLoaded;
  btnIndex.textContent = t(indexing ? 'controls.stopIndex' : 'controls.startIndex');
  btnDownload.textContent = t(downloading ? 'controls.stopDownload' : 'controls.startDownload');
  btnIndex.classList.toggle('active', indexing);
  btnIndex.classList.toggle('primary', !indexing);
  btnDownload.classList.toggle('active', downloading);
  btnLogin.textContent = t(authed ? 'controls.logout' : 'controls.login');
  btnLogin.disabled = indexing || downloading;
}

// ---- language ---------------------------------------------------------------
selLang.value = window.i18n.getLang();
window.i18n.applyStatic();
selLang.onchange = () => { window.i18n.setLang(selLang.value); renderStatus(); updateButtons(); };
setStatus('status.initial');

// ---- login / logout ---------------------------------------------------------
// Login happens in a separate popup managed by main; it auto-closes on success
// and fires 'auth-ok', at which point we (re)load the children list.
btnLogin.onclick = () => { if (authed) logout(); else window.api.openLogin(); };
window.api.onAuthOk(() => { childrenLoaded = false; loadChildren(); });

async function logout() {
  await window.api.logout();
  authed = false;
  childrenLoaded = false;
  selChild.innerHTML = `<option value="">${t('child.loginFirst')}</option>`;
  setStatus('status.loginFirst');
  updateButtons();
}

// ---- child picker -----------------------------------------------------------
async function loadChildren() {
  if (indexing || downloading) return;
  const prev = selChild.value || localStorage.getItem('childSel') || '';
  const res = await window.api.getChildren();
  authed = !!(res && res.ok);
  if (!res || !res.ok || !res.children.length) {
    childrenLoaded = false;
    selChild.innerHTML = `<option value="">${t('child.loginFirst')}</option>`;
    updateButtons();
    return;
  }
  childrenLoaded = true;
  selChild.innerHTML = '';
  for (const c of res.children) {
    const o = document.createElement('option');
    o.value = `${c.kindergartenId}:${c.id}`;
    o.textContent = c.name + (c.kindergarten ? ` — ${c.kindergarten}` : '');
    selChild.appendChild(o);
  }
  if ([...selChild.options].some((o) => o.value === prev)) selChild.value = prev;
  updateButtons();
}

selChild.onchange = () => { localStorage.setItem('childSel', selChild.value); updateButtons(); };
btnChildRefresh.onclick = () => { childrenLoaded = false; loadChildren(); };

// ---- download progress + activity (from main) -------------------------------
window.api.onDownloadProgress((p) => {
  totalIndexed = p.total;
  stat.discovered.textContent = p.total;
  stat.downloaded.textContent = p.ok;
  stat.skipped.textContent = p.skip;
  stat.failed.textContent = p.fail;
  stat.queued.textContent = p.queued;
  stat.active.textContent = p.inFlight;
  const handled = p.ok + p.skip + p.fail;
  const denom = handled + p.queued + p.inFlight;
  setProgress(denom ? handled / denom : 0);

  if (indexing && !downloading) setStatus('status.indexingProgress', { n: p.total });

  // Downloading finished: queue drained, nothing in flight, indexing not running.
  if (downloading && !indexing && p.queued === 0 && p.inFlight === 0) {
    downloading = false;
    window.api.downloadStop();
    updateButtons();
    if (!p.total) setStatus('status.indexFirst');
    else { setProgress(1, true); setStatus('status.done', { ok: p.ok, skip: p.skip, fail: p.fail, dir: outDir }); }
  }
});

const ACT_ICON = { ok: '✓', skip: '↷', fail: '✗' };
window.api.onDownloadItem((it) => {
  const li = document.createElement('li');
  li.className = it.status === 'ok' ? 'ok' : it.status === 'fail' ? 'fail' : 'skip';
  const ic = document.createElement('span'); ic.className = 'ic'; ic.textContent = ACT_ICON[it.status] || '·';
  const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = `${it.folder}/${it.filename}`;
  li.append(ic, nm);
  elActivity.prepend(li);
  while (elActivity.childElementCount > 80) elActivity.lastElementChild.remove();
});

// ---- output folder -----------------------------------------------------------
async function applyOutDir(dir) {
  outDir = dir;
  elOutDir.textContent = dir;
  elOutDir.classList.remove('muted');
  elOutDir.removeAttribute('data-i18n');
  resetStatGrid();
  const st = await window.api.loadState(dir);
  if (st && st.items && st.items.length) {
    totalIndexed = st.items.length;
    stat.discovered.textContent = st.items.length;
    setStatus('status.resumeAvailable', { n: st.items.length });
  } else {
    setStatus('status.folderReady');
  }
  updateButtons();
}

btnChoose.onclick = async () => {
  const dir = await window.api.chooseOutput();
  if (dir) await applyOutDir(dir);
};

// Restore last folder + try to load children on startup.
(async () => {
  const s = await window.api.getSettings();
  if (s && s.lastOutDir) await applyOutDir(s.lastOutDir);
  loadChildren();
})();

// ---- indexing toggle (API crawl) --------------------------------------------
btnIndex.onclick = () => { if (indexing) stopIndexing(); else startIndexing(); };

async function startIndexing() {
  if (!outDir || indexing) return;
  if (!selChild.value) { setStatus('status.selectChild'); return; }
  const [kindergartenId, childId] = selChild.value.split(':').map(Number);

  indexing = true;
  updateButtons();
  setStatus('status.indexing');
  await window.api.sessionOpen({ outDir });

  const res = await window.api.indexApi({ outDir, kindergartenId, childId });

  indexing = false;
  updateButtons();
  totalIndexed = res.total;
  if (!downloading) setStatus(res.total ? 'status.indexed' : 'status.noPhotos', { n: res.total });
}

async function stopIndexing() {
  setStatus('status.stoppingIndex');
  await window.api.indexStop();
}

// ---- download toggle --------------------------------------------------------
btnDownload.onclick = () => { if (downloading) stopDownloading(); else startDownloading(); };

async function startDownloading() {
  if (!outDir || downloading) return;
  downloading = true;
  updateButtons();
  setStatus('status.downloadingLive');
  await window.api.sessionOpen({ outDir });

  // Queue already-indexed items (covers download-only / resume).
  const st = await window.api.loadState(outDir);
  if (st && st.items && st.items.length) await window.api.indexEnqueue({ outDir, items: st.items });

  await window.api.downloadStart({ outDir });
}

async function stopDownloading() {
  await window.api.downloadStop();
  downloading = false;
  updateButtons();
  setStatus('status.downloadStopped', { n: totalIndexed });
}

updateButtons();
