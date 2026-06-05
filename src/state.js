'use strict';

// Pause/resume state, persisted in the output folder so reopening that folder
// continues where it left off. Discovery streams items here as they are found,
// so an interruption (pause, crash, quit) never loses progress.

const fs = require('fs');
const path = require('path');

const FILE = '.eliis-archiver-state.json';
const key = (it) => `${it.folder}|${it.title}`;

function file(dir) {
  return path.join(dir, FILE);
}

function load(dir) {
  try {
    return JSON.parse(fs.readFileSync(file(dir), 'utf8'));
  } catch (e) {
    return null;
  }
}

function ensure(dir) {
  return load(dir) || { version: 1, phase: 'new', includeVideos: false, items: [] };
}

function save(dir, st) {
  st.updatedAt = new Date().toISOString();
  const tmp = file(dir) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(st, null, 2));
  fs.renameSync(tmp, file(dir)); // atomic: never leaves a half-written state file
}

// Merge a batch of discovered items (deduped by folder|title) and update meta.
function appendItems(dir, items, meta) {
  const st = ensure(dir);
  if (meta) {
    if (meta.phase) st.phase = meta.phase;
    if (meta.includeVideos !== undefined) st.includeVideos = meta.includeVideos;
  }
  const map = new Map(st.items.map((it) => [key(it), it]));
  for (const it of items || []) map.set(key(it), it);
  st.items = [...map.values()];
  save(dir, st);
  return st.items.length;
}

function setMeta(dir, meta) {
  return appendItems(dir, [], meta);
}

module.exports = { load, appendItems, setMeta };
