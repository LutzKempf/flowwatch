const fs = require('fs');
const path = require('path');

/**
 * flowwatch.json: where a repo keeps the sources of Flowwatch's optional panels. Optional itself — a
 * repo without it has those panels "not set up".
 */

const WHERE = ['flowwatch.json', 'docs/flowwatch.json'];

/**
 * @param {string} repoRoot
 * @returns {{file: string|null, config: Record<string, any>|null, error: string|null, unreadable?: true}} the file found
 *   (root, else docs/), its parsed contents, and its error: a parse error when it is not valid JSON, or a
 *   read error (`unreadable`) when it is there but cannot be read — never taken for "no file"
 */
function readWiring(repoRoot) {
  for (const rel of WHERE) {
    let text;
    try {
      text = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    } catch (e) {
      const err = /** @type {NodeJS.ErrnoException} */ (e);
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') continue;
      return { file: rel, config: null, error: err.message, unreadable: true };
    }
    try {
      return { file: rel, config: JSON.parse(text), error: null };
    } catch (e) {
      return { file: rel, config: null, error: /** @type {Error} */ (e).message };
    }
  }
  return { file: null, config: null, error: null };
}

module.exports = { readWiring };
