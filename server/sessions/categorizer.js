const fs = require('fs');
const path = require('path');

/**
 * The repo's own category inference: the module flowwatch.json names under "sessions": { "categorize": "<path>" },
 * exporting inferCategory(branch, title). It files the sessions whose title names no category, and the specs and
 * changes no category owns. Without one, categories come from the title rule ("Category: goal") only.
 *
 * Never throws: a module that is missing, does not load or throws when called costs the inferred categories and
 * nothing else — the setup check names the problem ("Session categories"), the payloads carry on without it.
 * @param {string} repoRoot the path is relative to it
 * @param {Record<string, any>|null} config flowwatch.json's parsed contents (readWiring's `config`)
 * @returns {{state: 'ok'|'problem', detail: string, inferCategory: (...sources: string[]) => string|null}}
 */
function loadCategorizer(repoRoot, config) {
  const rel = config && config.sessions ? config.sessions.categorize : undefined;
  if (rel === undefined || rel === null) {
    return {
      state: 'ok',
      detail:
        'from session titles only ("Category: goal"); "sessions.categorize" in flowwatch.json ' +
        'can name a module that infers the rest',
      inferCategory: none,
    };
  }
  if (typeof rel !== 'string' || !rel.trim()) {
    return problem('"sessions.categorize" must be a path in the repo, such as "scripts/categorize.js"');
  }
  const file = path.resolve(repoRoot, rel);
  if (!fs.existsSync(file)) return problem('names ' + rel + ', which is not there');
  let mod;
  try {
    mod = require(file);
  } catch (e) {
    return problem(rel + ' could not be loaded: ' + /** @type {Error} */ (e).message);
  }
  if (!mod || typeof mod.inferCategory !== 'function')
    return problem(rel + ' does not export inferCategory(branch, title)');
  const infer = mod.inferCategory;
  return {
    state: 'ok',
    detail: 'infers the rest with ' + rel,
    inferCategory: (...sources) => {
      try {
        return categoryName(infer(...sources));
      } catch {
        return null;
      }
    },
  };
}

/**
 * The category a module's answer names: a string, or an object's `category` (a module may return richer answers),
 * normalised here so every caller gets a name or null.
 * @param {unknown} answer
 * @returns {string|null}
 */
function categoryName(answer) {
  const name = answer && typeof answer === 'object' ? /** @type {{category?: unknown}} */ (answer).category : answer;
  return typeof name === 'string' && name.trim() ? name : null;
}

const none = () => null;
/** @type {(detail: string) => {state: 'problem', detail: string, inferCategory: () => null}} */
const problem = (detail) => ({ state: 'problem', detail, inferCategory: none });

module.exports = { loadCategorizer };
