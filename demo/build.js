#!/usr/bin/env node
// Builds the demo: the dashboards as they are, reading a signed snapshot instead of a collector, as a static site
// that works under a subpath (GitHub Pages serves it at /flowwatch/). Refuses data nobody signed (demo/signoff.js).
//   node demo/build.js [--data <folder>]      (npm run build:demo) writes demo/site/
const fs = require('fs');
const path = require('path');
const { NAV, LANDING, resolvePanel, hrefOf } = require('../web/lib/nav');
const { verify, DATA_FILES } = require('./signoff');

const WEB = path.join(__dirname, '..', 'web');
// Where GitHub Pages serves the site, and `flowwatch demo` too.
const BASE = '/flowwatch/';

/**
 * The page GitHub Pages answers with for any address the site has no file for, such as a live dashboard's
 * /pipeline/sessions. It is served at the missing address, so its link is absolute.
 * @param {string} landing the landing panel's full address
 * @returns {string}
 */
function notFoundPage(landing) {
  return (
    '<!DOCTYPE html>\n<html lang="en">\n<meta charset="utf-8">\n<title>Not in the Flowwatch demo</title>\n' +
    '<style>body{font:16px/1.5 system-ui,sans-serif;background:#0a0a0b;color:#ececee;margin:15vh auto;max-width:34em;' +
    'padding:0 16px}a{color:#5ac8fa}</style>\n' +
    '<h1>Not in the demo</h1>\n<p>This address is not part of the Flowwatch demo.</p>\n' +
    '<p><a href="' +
    landing +
    '">Open the demo</a></p>\n</html>\n'
  );
}

/**
 * A live page, as a demo page: it knows it is one from a config written in before any script runs (lib/data.js
 * reads it), and loads lib/ and pages/ relative to itself. The config is JSON with every "<" escaped, so nothing in
 * the snapshot's metadata can close its script tag.
 * @param {string} html the live page
 * @param {{project: string, snapshotAt: number}} meta what the demo banner shows
 * @returns {string}
 */
function demoPage(html, meta) {
  const config = '<script>window.FLOWWATCH_DEMO=' + JSON.stringify(meta).replace(/</g, '\\u003c') + ';</script>\n';
  return html.replace(/(src|href)="\/(lib|pages)\//g, '$1="$2/').replace('</head>', config + '</head>');
}

/**
 * @param {{dataDir: string, outDir: string}} opts outDir is emptied first
 * @returns {{outDir: string, hash: string}}
 */
function build({ dataDir, outDir }) {
  const signed = verify(dataDir);
  if (!signed.ok) throw new Error(signed.message);
  const meta = JSON.parse(fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf8'));
  if (typeof meta.project !== 'string' || !meta.project || !Number.isFinite(meta.snapshotAt)) {
    throw new Error('meta.json needs "project" (a name) and "snapshotAt" (ms since 1970)');
  }
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'data'), { recursive: true });
  // The pages' shared scripts and styles, and each page's own; a page's modules import each other relatively.
  for (const dir of ['lib', 'pages']) fs.cpSync(path.join(WEB, dir), path.join(outDir, dir), { recursive: true });
  for (const g of NAV) {
    const html = fs.readFileSync(path.join(WEB, g.file), 'utf8');
    fs.writeFileSync(path.join(outDir, g.file), demoPage(html, { project: meta.project, snapshotAt: meta.snapshotAt }));
  }
  for (const f of DATA_FILES) fs.copyFileSync(path.join(dataDir, f), path.join(outDir, 'data', f));
  // The site's own address opens Sessions, as the collector's bare host does. LANDING is a panel, so it resolves.
  const land = /** @type {NonNullable<ReturnType<typeof resolvePanel>>} */ (resolvePanel(LANDING));
  const to = hrefOf(land.group, land.panel, true);
  fs.writeFileSync(
    path.join(outDir, 'index.html'),
    '<!DOCTYPE html>\n<meta charset="utf-8">\n<title>Flowwatch demo</title>\n' +
      '<meta http-equiv="refresh" content="0; url=' +
      to +
      '">\n<a href="' +
      to +
      '">Open the Flowwatch demo</a>\n'
  );
  fs.writeFileSync(path.join(outDir, '404.html'), notFoundPage(BASE + to));
  fs.writeFileSync(path.join(outDir, '.nojekyll'), ''); // GitHub Pages: serve the files as they are
  return { outDir, hash: signed.hash };
}

module.exports = { build, BASE };

if (require.main === module) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--data');
  const dataDir = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : path.join(__dirname, 'data'));
  try {
    const r = build({ dataDir, outDir: path.join(__dirname, 'site') });
    process.stdout.write(
      'built the demo from ' + dataDir + ' (signed ' + r.hash.slice(0, 12) + ') into ' + r.outDir + '\n'
    );
  } catch (e) {
    process.stderr.write(/** @type {Error} */ (e).message + '\n');
    process.exitCode = 1;
  }
}
