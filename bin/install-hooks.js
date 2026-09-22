const fs = require('fs');
const path = require('path');
const fragment = require('../templates/hooks.json');

/** @typedef {{hooks: Object<string, object[]>, statusLine?: object}} HookFragment what Flowwatch adds to a settings file */

/**
 * Append-only merge: never removes or replaces an existing entry; skips entries
 * already present. An existing statusLine always wins over the fragment's.
 * @param {Record<string, any>|null} existing parsed settings (or null/{} for a fresh file)
 * @param {HookFragment} frag Flowwatch's hooks (templates/hooks.json)
 * @returns {Record<string, any>} merged settings object (input untouched)
 */
function mergeHookSettings(existing, frag) {
  /** @type {HookFragment & Record<string, any>} */
  const out = JSON.parse(JSON.stringify(existing || {}));
  out.hooks = out.hooks || {};
  for (const [event, entries] of Object.entries(frag.hooks)) {
    out.hooks[event] = out.hooks[event] || [];
    for (const entry of entries) {
      const already = out.hooks[event].some((e) => JSON.stringify(e) === JSON.stringify(entry));
      if (!already) out.hooks[event].push(entry);
    }
  }
  if (frag.statusLine && !out.statusLine) out.statusLine = frag.statusLine;
  return out;
}

/**
 * Installs the fragment into a settings file. A target that EXISTS but fails
 * JSON.parse throws WITHOUT writing — never wipe a malformed settings file.
 * @param {string} target settings file path
 * @param {{frag?: HookFragment, log?: (m:string)=>void, warn?: (m:string)=>void}} [opts]
 * @returns {{statusLineKept: boolean}} true when a different pre-existing
 *   statusLine was kept (Flowwatch token telemetry NOT wired)
 */
function runInstall(target, { frag = fragment, log = console.log, warn = console.warn } = {}) {
  /** @type {Record<string, any>} */
  let existing = {};
  if (fs.existsSync(target)) {
    const raw = fs.readFileSync(target, 'utf8');
    try {
      existing = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `[flowwatch] ${target} exists but is not valid JSON (${/** @type {Error} */ (e).message}) — ` +
          'NOT overwriting; fix or remove the file, then re-run install-hooks',
        { cause: e }
      );
    }
  }
  const merged = mergeHookSettings(existing, frag);
  const statusLineKept = !!(
    frag.statusLine &&
    existing.statusLine &&
    JSON.stringify(existing.statusLine) !== JSON.stringify(frag.statusLine)
  );
  if (statusLineKept) {
    warn('[flowwatch] existing statusLine kept — Flowwatch token telemetry NOT wired');
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(merged, null, 2) + '\n');
  log(`[flowwatch] hooks merged into ${target} (existing entries preserved)`);
  return { statusLineKept };
}

/**
 * The hooks for a repo. They run the emitter the repo installed (node_modules/flowwatch/), or, in the
 * Flowwatch repo itself, its own hooks/ folder.
 * @param {string} repoRoot the repo the hooks are for
 * @returns {HookFragment} the fragment to merge
 */
function fragmentFor(repoRoot) {
  let name = null;
  try {
    name = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).name;
  } catch {
    /* not a package */
  }
  if (name !== 'flowwatch') return fragment;
  return JSON.parse(JSON.stringify(fragment).split('node_modules/flowwatch/').join(''));
}

module.exports = { mergeHookSettings, runInstall, fragmentFor };
