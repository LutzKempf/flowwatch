#!/usr/bin/env node
// The sign-off. The demo publishes a snapshot of real dashboards, so the build takes only data a person has read and
// signed: SIGNOFF in the data folder holds the hash of exactly the files the build publishes, and a changed byte,
// a renamed file or a missing one breaks it. Run this on a data folder to print its hash; writing that hash into
// its SIGNOFF is the signature, so do it only once every file has been read and is fit to publish.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ENDPOINTS } = require('../web/lib/data');

// What the build publishes: each endpoint's answer, and whose dashboards they are, from when.
const DATA_FILES = [...ENDPOINTS.map((n) => n + '.json'), 'meta.json'].sort();

/**
 * sha256 over the data files, in name order, each as its name, its length and its bytes, so no byte can move from
 * one file to the next unnoticed. Any other file in the folder is not published, and not hashed.
 * @param {string} dir the data folder
 * @returns {string} hex
 */
function hashData(dir) {
  const h = crypto.createHash('sha256');
  for (const name of DATA_FILES) {
    const bytes = fs.readFileSync(path.join(dir, name));
    h.update(name + '\0' + bytes.length + '\0');
    h.update(bytes);
  }
  return h.digest('hex');
}

/**
 * Whether the data folder is signed as it is now.
 * @param {string} dir
 * @returns {{ok: true, hash: string, message?: undefined}|{ok: false, hash?: string, message: string}}
 */
function verify(dir) {
  const refuse = 'refusing to build the demo: ';
  const missing = DATA_FILES.filter((f) => !fs.existsSync(path.join(dir, f)));
  if (missing.length) {
    return {
      ok: false,
      message:
        refuse +
        dir +
        ' is missing ' +
        missing.join(', ') +
        '. Take a snapshot with ' +
        'demo/snapshot.js, clean it, and sign it (demo/signoff.js).',
    };
  }
  const hash = hashData(dir);
  let signed = null;
  try {
    signed = fs.readFileSync(path.join(dir, 'SIGNOFF'), 'utf8').trim();
  } catch {
    /* not signed */
  }
  if (signed === hash) return { ok: true, hash };
  return {
    ok: false,
    hash,
    message:
      refuse +
      'the snapshot in ' +
      dir +
      ' has no matching sign-off (' +
      (signed ? 'SIGNOFF holds ' + signed : 'no SIGNOFF file') +
      '; the data hashes to ' +
      hash +
      '). Read every file ' +
      'in it; once it is fit to publish, write that hash into ' +
      path.join(dir, 'SIGNOFF') +
      '.',
  };
}

module.exports = { DATA_FILES, hashData, verify };

if (require.main === module) {
  const dir = path.resolve(process.argv[2] || path.join(__dirname, 'data'));
  const r = verify(dir);
  if (!r.hash) {
    process.stderr.write(r.message + '\n');
    process.exitCode = 1;
  } else {
    process.stdout.write(r.hash + '\n');
    process.stderr.write(
      r.ok
        ? 'signed: SIGNOFF matches\n'
        : 'not signed: SIGNOFF ' + (r.message.includes('no SIGNOFF file') ? 'is missing' : 'holds another hash') + '\n'
    );
    process.exitCode = r.ok ? 0 : 1;
  }
}
