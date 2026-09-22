// A dashboard page as the browser loads it: the HTML, every stylesheet and script it names, and every module those
// import, each once. The page tests read source through this, so code moved into a new file of a page stays checked.
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', '..', '..', 'web');

/**
 * @param {string} page the page's file under web/, e.g. 'pipeline.html'
 * @returns {Array<[string, string]>} [its path under web/, its text], the page first
 */
function pageFiles(page) {
  const files = new Map();
  const visit = (rel) => {
    if (files.has(rel)) return;
    const text = fs.readFileSync(path.join(WEB, rel), 'utf8');
    files.set(rel, text);
    const refs = rel.endsWith('.html')
      ? [...text.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="\/([^"]+)"/g)].map((m) => m[1])
      : [...text.matchAll(/^import (?:[^']* from )?'(\.[^']+)';$/gm)].map((m) =>
          path.posix.join(path.posix.dirname(rel), m[1])
        );
    refs.forEach(visit);
  };
  visit(page);
  return [...files];
}

/**
 * The page's own files: its HTML, stylesheet and modules, without the helpers web/lib/ shares with the other page.
 * @param {string} page
 * @returns {Array<[string, string]>}
 */
const ownFiles = (page) => pageFiles(page).filter(([rel]) => !rel.startsWith('lib/'));

/**
 * One file of a page, by its path under web/, read through the page so a file the page no longer loads fails here.
 * @param {string} page
 * @param {string} rel
 * @returns {string}
 */
function pageFile(page, rel) {
  const hit = pageFiles(page).find(([r]) => r === rel);
  if (!hit) throw new Error(page + ' does not load ' + rel);
  return hit[1];
}

module.exports = { WEB, pageFiles, ownFiles, pageFile };
