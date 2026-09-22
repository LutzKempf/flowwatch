const fs = require('fs');
const path = require('path');
const { missionOf } = require('../repo/missionFile');
const { readWiring } = require('../repo/settings');
const { feedSource } = require('../feeds');
const { loadCategorizer } = require('../sessions/categorizer');
const { bannerItems } = require('./setupRules');

/**
 * What is set up for Flowwatch in a repo, and what is missing: one list for the pages' banner
 * (GET /api/setup) and for agents (npx flowwatch check). Each item names the SETUP.md
 * step that fixes it. Reads files only.
 */

// The SETUP.md steps, by number and title; the page and the CLI print them as they are.
const STEP = {
  collector: '2 Start the collector',
  mission: '3 Write the mission',
  optional: '4 Optional panels',
  hooks: '5 Session tracking',
};

/**
 * Hook commands in the repo's Claude Code settings that run the pipeline emitter, and whether its file exists.
 * @param {string} repoRoot
 * @returns {{state: string, detail: string}}
 */
function hooksOf(repoRoot) {
  const found = [];
  for (const rel of ['.claude/settings.json', '.claude/settings.local.json']) {
    let settings;
    try {
      settings = JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
    } catch {
      continue;
    }
    for (const groups of Object.values((settings && settings.hooks) || {})) {
      for (const g of groups || []) {
        for (const h of (g && g.hooks) || []) {
          const m = String(h.command || '').match(/"?\$CLAUDE_PROJECT_DIR[\\/]([^"\s]*hooks[\\/]emit\.js)"?/);
          if (m) found.push({ settings: rel, script: m[1].replace(/\\/g, '/') });
        }
      }
    }
  }
  if (!found.length)
    return {
      state: 'missing',
      detail: 'no hook in .claude/settings.json or settings.local.json runs the Flowwatch emitter',
    };
  const working = found.find((f) => fs.existsSync(path.join(repoRoot, f.script)));
  if (working) return { state: 'ok', detail: 'installed in ' + working.settings + ', running ' + working.script };
  return { state: 'problem', detail: 'the hooks run ' + found[0].script + ', which does not exist in this repo' };
}

// Every optional panel but Specs is fed by the repo through a command or a file (server/feeds.js). The check
// reads the entry, never runs it.
const FEEDS = { stages: 'Stages panel', ideas: 'Ideas panel', value: 'Value figures', gates: 'Gates panel' };

/**
 * @param {{repoRoot: string}} input the repo Flowwatch runs in
 * @returns {{items: Array<{id: string, required: boolean, state: string, title: string, detail: string,
 *   step: string}>, banner: Array<{id: string, state: string, required: boolean}>, ok: boolean}} `banner` is
 *   what the banner lists (empty: no
 *   banner); `ok` is false exactly when it shows, which is also when `npx flowwatch check` exits 1
 */
function checkSetup({ repoRoot }) {
  const items = [];
  // The page's own reader, so the page and this list can never disagree — an unreadable file included.
  const mission = missionOf(repoRoot);
  const rel = (/** @type {string} */ p) => path.relative(repoRoot, p).split(path.sep).join('/');
  items.push({
    id: 'mission',
    required: true,
    state: mission.file ? 'ok' : 'missing',
    title: 'The mission (MISSION.md)',
    detail: mission.file || 'no MISSION.md at the repo root or in docs/',
    step: STEP.mission,
  });
  if (mission.file) {
    const problems = mission.problems;
    items.push({
      id: 'mission-problems',
      required: true,
      state: problems.length ? 'problem' : 'ok',
      title: 'MISSION.md reads completely',
      detail: problems.length ? problems.join('; ') : 'every part read',
      step: STEP.mission,
    });
  }
  const wiring = readWiring(repoRoot);
  items.push({
    id: 'wiring',
    required: true,
    state: wiring.error ? 'problem' : 'ok',
    title: 'flowwatch.json',
    detail: wiring.error
      ? wiring.file + (wiring.unreadable ? ' could not be read: ' : ' is not valid JSON: ') + wiring.error
      : wiring.file || 'none (optional)',
    step: STEP.optional,
  });
  items.push({ id: 'hooks', required: true, title: 'Session tracking hooks', step: STEP.hooks, ...hooksOf(repoRoot) });
  if (!wiring.error) {
    for (const [id, title] of Object.entries(FEEDS)) {
      const p = feedSource(repoRoot, wiring, id);
      items.push({
        id,
        required: false,
        state: p.state === 'data' ? 'ok' : p.state,
        title,
        detail: p.reason || p.detail || (p.state === 'off' ? 'turned off in ' + wiring.file : 'not in flowwatch.json'),
        step: STEP.optional,
      });
    }
    // Loads the module, as the collector does: "is it there" is not enough when it throws on load.
    const { state, detail } = loadCategorizer(repoRoot, wiring.config);
    items.push({ id: 'categorize', required: false, state, title: 'Session categories', detail, step: STEP.optional });
  }
  // A broken file names no panel's state, Specs included: the wiring item above already reports it.
  const openspec = wiring.config ? wiring.config.openspec : undefined;
  const specs = path.resolve(repoRoot, (openspec && openspec.specs) || 'openspec/specs');
  if (!wiring.error)
    items.push(
      openspec === false
        ? {
            id: 'specs',
            required: false,
            state: 'off',
            title: 'Specs (openspec)',
            detail: 'turned off in ' + wiring.file,
            step: STEP.optional,
          }
        : {
            id: 'specs',
            required: false,
            state: fs.existsSync(specs) ? 'ok' : 'not-set-up',
            title: 'Specs (openspec)',
            detail: fs.existsSync(specs) ? rel(specs) : 'no ' + rel(specs) + ' folder (optional)',
            step: STEP.optional,
          }
    );
  const banner = bannerItems(items);
  return { items, banner, ok: banner.length === 0 };
}

module.exports = { checkSetup, STEP };
