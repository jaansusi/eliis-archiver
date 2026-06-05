'use strict';

// App-level settings persisted across restarts (separate from the per-folder
// resume state). Stored in Electron's userData dir so it survives app updates.
// Currently just remembers the last-used output folder.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch (e) {
    return {};
  }
}

function save(patch) {
  const next = { ...load(), ...patch };
  try {
    fs.writeFileSync(file(), JSON.stringify(next, null, 2));
  } catch (e) { /* ignore */ }
  return next;
}

module.exports = { load, save };
