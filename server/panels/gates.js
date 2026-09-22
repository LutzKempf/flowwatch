/**
 * The gates feed: what a repo's gate runner is running, what waits in the order it will start them, its
 * scheduler's state, and how long gates usually take here. Read-only by construction: Flowwatch shows the
 * runner's own order and never changes it.
 *
 * Format 1: `{ "format": 1, "generated_at"?: ms, "running": [{ "worktree", "granted_at": ms, "branch"?, "sha"?,
 * "ran_ms"?, "mode"?, "cores"? }], "waiting": [{ "position": 1…, "worktree", "branch"?, "sha"?, "queued_since"?: ms,
 * "waited_ms"? }], "scheduler"?: { "tick_age_ms"?, "stalled"?, "blocked"?, "mode"? },
 * "history"?: { "runs", "p25", "median", "p75", "p90", "window_days" } | null }`. Times are milliseconds since
 * 1970; durations are milliseconds, except history's, which are whole minutes over `window_days` days.
 */
const { isName, optional } = require('./formatChecks');

/** @type {(v: unknown) => boolean} */
const isText = (v) => typeof v === 'string';
/** @type {(v: unknown) => boolean} */
const isAmount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const HISTORY = ['runs', 'p25', 'median', 'p75', 'p90', 'window_days'];

/**
 * Each field's rule, and what the problem says when a value breaks it.
 * @type {Object<string, [(v: unknown) => boolean, string]>}
 */
const RULES = {
  text: [isText, 'must be text'],
  amount: [isAmount, 'must be a number from 0'],
  time: [isAmount, 'must be a time in milliseconds'],
  flag: [(v) => typeof v === 'boolean', 'must be true or false'],
};
const RUNNING = { branch: 'text', sha: 'text', ran_ms: 'amount', mode: 'text', cores: 'amount' };
const WAITING = { queued_since: 'time', waited_ms: 'amount' };
const SCHEDULER = { tick_age_ms: 'amount', stalled: 'flag', blocked: 'text', mode: 'text' };

/**
 * The optional fields of `obj` that break their rule, named from `at`.
 * @param {Record<string, any>} obj
 * @param {string} at
 * @param {Object<string, string>} fields each field's rule, by name
 * @returns {string[]}
 */
function optionalProblems(obj, at, fields) {
  return Object.entries(fields).flatMap(([k, rule]) =>
    optional(obj[k], RULES[rule][0]) ? [] : [at + '.' + k + ' ' + RULES[rule][1]]
  );
}

/** @type {(v: unknown) => boolean} */
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {any} data a parsed gates feed, not yet checked
 * @returns {string[]} what does not match the format; empty when it matches
 */
function checkGates(data) {
  /** @type {string[]} */
  const problems = [];
  if (!optional(data.generated_at, isAmount)) problems.push('"generated_at" must be a time in milliseconds');
  if (!Array.isArray(data.running)) problems.push('"running" must be a list');
  else
    data.running.forEach((/** @type {any} */ r, /** @type {number} */ i) => {
      const at = 'running[' + i + ']';
      if (!isObject(r)) {
        problems.push(at + ' must be an object');
        return;
      }
      if (!isName(r.worktree)) problems.push(at + '.worktree must be a name');
      if (!isAmount(r.granted_at)) problems.push(at + '.granted_at must be a time in milliseconds');
      problems.push(...optionalProblems(r, at, RUNNING));
    });
  if (!Array.isArray(data.waiting)) problems.push('"waiting" must be a list');
  else
    data.waiting.forEach((/** @type {any} */ w, /** @type {number} */ i) => {
      const at = 'waiting[' + i + ']';
      if (!isObject(w)) {
        problems.push(at + ' must be an object');
        return;
      }
      if (!(Number.isInteger(w.position) && w.position >= 1))
        problems.push(at + '.position must be a whole number from 1');
      if (!isName(w.worktree)) problems.push(at + '.worktree must be a name');
      problems.push(...optionalProblems(w, at, WAITING));
    });
  if (data.scheduler !== undefined) {
    if (!isObject(data.scheduler)) problems.push('"scheduler" must be an object');
    else problems.push(...optionalProblems(data.scheduler, 'scheduler', SCHEDULER));
  }
  if (data.history !== undefined && data.history !== null) {
    if (!isObject(data.history)) problems.push('"history" must be an object or null');
    else
      problems.push(
        ...HISTORY.filter((k) => !isAmount(data.history[k])).map((k) => 'history.' + k + ' must be a number from 0')
      );
  }
  return problems;
}

module.exports = { checkGates };
