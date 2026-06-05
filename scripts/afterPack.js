'use strict';

// electron-builder afterPack hook. We ship unsigned (no Apple Developer ID), but
// Apple Silicon refuses to run an app with no signature at all ("…is damaged").
// An ad-hoc signature (codesign --sign -) fixes that: the app runs after the
// quarantine attribute is removed, and Gatekeeper shows the normal
// "unidentified developer" prompt instead of "damaged".

const path = require('path');
const { execFileSync } = require('child_process');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  console.log(`ad-hoc signed ${appName}`);
};
