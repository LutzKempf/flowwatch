const fs = require('fs');
const path = require('path');

/**
 * @typedef {{implemented: number, known_broken: number, aspirational: number, not_applicable: number,
 *   total: number}} TagCounts
 */

/**
 * Counts scenario status tags in one .feature file.
 * @param {string} file feature file path
 * @returns {TagCounts}
 */
function countTags(file) {
  const t = fs.readFileSync(file, 'utf8');
  const n = (/** @type {RegExp} */ re) => (t.match(re) || []).length;
  const implemented = n(/@implemented\b/g);
  const known_broken = n(/@known-broken\b/g);
  const aspirational = n(/@aspirational\b/g);
  const not_applicable = n(/@not-applicable\b/g);
  return {
    implemented,
    known_broken,
    aspirational,
    not_applicable,
    total: implemented + known_broken + aspirational + not_applicable,
  };
}

/**
 * Tag counts for every capability .feature in a specs dir.
 * @param {string|null} dir openspec/specs directory (null: none)
 * @returns {{capabilities: Object<string, TagCounts>, totals: TagCounts, missing?: true}} keyed by capability
 *   basename; a repo with no specs folder has no specs yet (`missing`), which is a state, not a failure
 */
function parseSpecsDir(dir) {
  if (!dir || !fs.existsSync(dir)) {
    return {
      capabilities: {},
      totals: { implemented: 0, known_broken: 0, aspirational: 0, not_applicable: 0, total: 0 },
      missing: true,
    };
  }
  /** @type {Object<string, TagCounts>} */
  const capabilities = {};
  /** @type {TagCounts} */
  const totals = { implemented: 0, known_broken: 0, aspirational: 0, not_applicable: 0, total: 0 };
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.feature'))) {
    const c = countTags(path.join(dir, f));
    capabilities[path.basename(f, '.feature')] = c;
    for (const k of /** @type {Array<keyof TagCounts>} */ (Object.keys(totals))) totals[k] += c[k];
  }
  return { capabilities, totals };
}

module.exports = { countTags, parseSpecsDir };
