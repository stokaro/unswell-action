// Inject filesystem failures below fs.rm so the entry point exercises real retries.
import fs from 'node:fs';
import path from 'node:path';
import './fetch-fixture.mjs';

const unlink = fs.unlink;
let attempts = 0;
fs.unlink = function (filename, callback) {
  const target = String(filename);
  if (path.basename(path.dirname(target)) === 'install'
      && /^unswell(?:\.exe)?$/.test(path.basename(target))) {
    attempts++;
    fs.appendFileSync(process.env.UNSWELL_CLEANUP_ATTEMPTS, `${attempts}\n`);
    if (process.env.UNSWELL_CLEANUP_FAILURE === 'persistent' || attempts <= 2) {
      const error = Object.assign(new Error('Test executable is busy'), { code: 'EBUSY', path: target });
      process.nextTick(callback, error);
      return;
    }
  }
  return unlink.call(this, filename, callback);
};
