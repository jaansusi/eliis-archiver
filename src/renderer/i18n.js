'use strict';

// Tiny i18n. Estonian is the default. Translatable static elements carry
// data-i18n / data-i18n-title attributes; dynamic strings go through t().
(function () {
  const STRINGS = {
    et: {
      'nav.back': 'Tagasi',
      'nav.forward': 'Edasi',
      'nav.reload': 'Värskenda',
      'nav.home': 'Avaleht (eliis.eu)',
      'lang.label': 'Keel',
      'controls.choose': 'Vali sihtkoht',
      'controls.noFolder': 'Sihtkoht määramata',
      'controls.child': 'Laps',
      'controls.login': 'Logi sisse',
      'controls.logout': 'Logi välja',
      'controls.startIndex': 'Indekseeri',
      'controls.stopIndex': 'Peata indekseerimine',
      'controls.startDownload': 'Lae alla',
      'controls.stopDownload': 'Peata allalaadimine',
      'child.loginFirst': 'Logi esmalt sisse',
      'child.loading': 'Laen…',
      'app.title': 'Eliisi arhiveerija',
      'section.settings': 'Seaded',
      'section.progress': 'Edenemine',
      'section.activity': 'Tegevus',
      'stats.discovered': 'Leitud',
      'stats.downloaded': 'Alla laetud',
      'stats.skipped': 'Vahele jäetud',
      'stats.failed': 'Ebaõnnestunud',
      'stats.queued': 'Järjekorras',
      'stats.active': 'Töös',
      'activity.empty': 'Tegevust veel pole.',
      'status.initial': 'Logi Eliisi sisse ja vali laps ning sihtkoht.',
      'status.loginFirst': 'Logi Eliisi sisse, et lapsed laadida.',
      'status.selectChild': 'Vali laps.',
      'status.folderReady': 'Valmis. Vali laps ja vajuta Indekseeri.',
      'status.resumeAvailable': 'Jätkamine võimalik: selles kaustas on juba {n} faili indekseeritud.',
      'status.indexing': 'Indekseerin…',
      'status.indexingProgress': 'Indekseerin… {n} faili leitud',
      'status.indexed': 'Indekseeritud {n} faili. Vajuta „Lae alla“, et failid alla laadida.',
      'status.stoppingIndex': 'Peatan indekseerimise…',
      'status.downloadingLive': 'Laen alla…',
      'status.downloadStopped': 'Allalaadimine peatatud — {n} faili indekseeritud.',
      'status.indexFirst': 'Pole midagi alla laadida — indekseeri esmalt.',
      'status.done': 'Valmis — alla laetud {ok}, vahele jäetud {skip}, ebaõnnestus {fail} → {dir}',
      'status.noPhotos': 'Pilte ei leitud — veendu, et lapse päeviku leht on avatud, ja proovi uuesti.',
      'status.discoveryFailed': 'Indekseerimine ebaõnnestus: {err}',
    },
    en: {
      'nav.back': 'Back',
      'nav.forward': 'Forward',
      'nav.reload': 'Reload',
      'nav.home': 'Home (eliis.eu)',
      'lang.label': 'Language',
      'controls.choose': 'Choose output folder…',
      'controls.noFolder': 'no folder chosen',
      'controls.child': 'Child',
      'controls.login': 'Log in',
      'controls.logout': 'Log out',
      'controls.startIndex': 'Index',
      'controls.stopIndex': 'Stop indexing',
      'controls.startDownload': 'Download',
      'controls.stopDownload': 'Stop downloading',
      'child.loginFirst': 'Log in first',
      'child.loading': 'Loading…',
      'app.title': 'Eliis Archiver',
      'section.settings': 'Settings',
      'section.progress': 'Progress',
      'section.activity': 'Activity',
      'stats.discovered': 'Discovered',
      'stats.downloaded': 'Downloaded',
      'stats.skipped': 'Skipped',
      'stats.failed': 'Failed',
      'stats.queued': 'Queued',
      'stats.active': 'Active',
      'activity.empty': 'No activity yet.',
      'status.initial': 'Log into Eliis, then choose a child and an output folder.',
      'status.loginFirst': 'Log into Eliis to load children.',
      'status.selectChild': 'Select a child.',
      'status.folderReady': 'Ready. Choose a child and click Index.',
      'status.resumeAvailable': 'Resume available: {n} items already indexed in this folder.',
      'status.indexing': 'Indexing…',
      'status.indexingProgress': 'Indexing… {n} items found',
      'status.indexed': 'Indexed {n} items. Click “Download” to fetch the files.',
      'status.stoppingIndex': 'Stopping indexing…',
      'status.downloadingLive': 'Downloading…',
      'status.downloadStopped': 'Download stopped — {n} items indexed.',
      'status.indexFirst': 'Nothing to download — index first.',
      'status.done': 'Done — downloaded {ok}, skipped {skip}, failed {fail} → {dir}',
      'status.noPhotos': "No photos found — make sure a child's diary page is open, then try again.",
      'status.discoveryFailed': 'Indexing failed: {err}',
    },
  };

  let lang = localStorage.getItem('lang') || 'et';

  function t(keyName, vars) {
    const table = STRINGS[lang] || STRINGS.et;
    const s = table[keyName] || STRINGS.en[keyName] || keyName;
    return s.replace(/\{(\w+)\}/g, (_, k) => (vars && k in vars ? vars[k] : ''));
  }

  function applyStatic() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = t(el.getAttribute('data-i18n-title'));
    });
  }

  function setLang(l) {
    lang = l;
    localStorage.setItem('lang', l);
    applyStatic();
  }

  window.i18n = { t, setLang, getLang: () => lang, applyStatic };
})();
