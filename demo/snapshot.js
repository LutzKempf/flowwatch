#!/usr/bin/env node
// Takes a snapshot of a running Flowwatch for the demo: every endpoint the pages read, each saved exactly as the
// collector answered it, plus meta.json (whose dashboards, and when). What it writes is raw, straight from someone's
// real repo: it is cleaned and signed (demo/signoff.js) before anything is published.
//   node demo/snapshot.js <collector URL> [--out <folder>] [--project <name>]
const fs = require('fs');
const path = require('path');
const { ENDPOINTS, urlOf } = require('../web/lib/data');

/**
 * Reads every endpoint first and writes only once all of them answered, so a failed snapshot leaves nothing behind.
 * @param {string} base the collector's address, e.g. http://127.0.0.1:4477
 * @param {string} outDir the data folder to write
 * @param {{project?: string, now?: () => number}} [opts] project: the name the demo banner gives (default: the
 *   collector's repo folder); now: the clock (tests)
 * @returns {Promise<{project: string|undefined, snapshotAt: number}>} meta.json
 */
async function snapshot(base, outDir, { project, now = Date.now } = {}) {
  const snapshotAt = now();
  /** @type {Record<string, any>} each endpoint's answer, as bytes */
  const bodies = {};
  for (const name of ENDPOINTS) {
    const r = await fetch(new URL(urlOf(name, false), base));
    if (!r.ok) throw new Error(name + ': HTTP ' + r.status);
    bodies[name] = Buffer.from(await r.arrayBuffer());
  }
  const meta = {
    project: project || String(JSON.parse(bodies.setup).repoRoot).split(/[\\/]/).filter(Boolean).pop(),
    snapshotAt,
  };
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of ENDPOINTS) fs.writeFileSync(path.join(outDir, name + '.json'), bodies[name]);
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  return meta;
}

module.exports = { snapshot };

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (/** @type {string} */ name) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
  const base = args[0];
  if (!base || base.startsWith('--')) {
    process.stderr.write('usage: node demo/snapshot.js <collector URL> [--out <folder>] [--project <name>]\n');
    process.exitCode = 1;
  } else {
    const out = path.resolve(opt('--out') || path.join(__dirname, 'data'));
    snapshot(base, out, { project: opt('--project') }).then(
      (meta) => {
        process.stdout.write(
          'wrote a snapshot of ' +
            meta.project +
            ' to ' +
            out +
            '. Clean it, then sign it: node demo/signoff.js ' +
            out +
            '\n'
        );
      },
      (e) => {
        process.stderr.write('snapshot: ' + e.message + '\n');
        process.exitCode = 1;
      }
    );
  }
}
