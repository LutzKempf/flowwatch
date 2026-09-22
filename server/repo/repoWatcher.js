const fs = require('fs');
const path = require('path');
const { ingestEvent } = require('../ingest');

/** @typedef {import('better-sqlite3').Database} Database */
/**
 * flowwatch.json "pipeline": the folders where the repo's own checks leave their results, each relative to the
 * repo. A folder the repo does not name is not scanned.
 * @typedef {{passMarkers?: string, goalMarkers?: string, evidence?: string}} PipelineSettings
 */

/**
 * @param {Database} db
 * @param {string} worktree
 * @returns {string|null} the session last seen in that worktree
 */
function latestSessionIn(db, worktree) {
  const row = /** @type {{id: string}|undefined} */ (
    db.prepare('SELECT id FROM sessions WHERE worktree=? ORDER BY last_seen DESC LIMIT 1').get(worktree)
  );
  return row ? row.id : null;
}

/**
 * Pass markers: <folder>/<sha>.json, written by the repo's pre-merge check when it passes, naming a session_id or
 * a worktree. Each gets a deterministic id, so re-scanning the same marker is a no-op via ingest dedupe. NEVER
 * invents a session: a marker that can't be attributed is skipped, since a made-up session would put a lane on the
 * board that nobody ran.
 * @param {Database} db
 * @param {string} root the repo
 * @param {string} folder the markers' folder, relative to the repo
 * @returns {number} events newly ingested
 */
function scanGatePass(db, root, folder) {
  const dir = path.join(root, folder);
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'last-run.json')) {
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      continue;
    }
    const sessionId = meta.session_id || (meta.worktree && latestSessionIn(db, meta.worktree));
    if (!sessionId) continue; // unattributable — skip, don't invent
    const ev = {
      id: `gatepass:${f}`,
      session_id: sessionId,
      worktree: meta.worktree || null,
      ts: fs.statSync(path.join(dir, f)).mtimeMs,
      type: 'gate_pass',
    };
    if (ingestEvent(db, ev)) n++;
  }
  return n;
}

/**
 * Per-change pass markers live one level deeper, one folder per change: <folder>/<change>/<sha>.json. Same
 * attribution and skip rules as pass markers; anything else in the folder (a lock, a log, a last-run file) is
 * excluded by the sha-shaped filename filter.
 * @param {Database} db
 * @param {string} root the repo
 * @param {string} folder the markers' folder, relative to the repo
 * @returns {number} events newly ingested
 */
function scanGoalPass(db, root, folder) {
  const base = path.join(root, folder);
  if (!fs.existsSync(base)) return 0;
  let n = 0;
  for (const topic of fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const dir = path.join(base, topic.name);
    for (const f of fs.readdirSync(dir).filter((f) => /^[0-9a-f]{40}\.json$/.test(f))) {
      let meta;
      try {
        meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      } catch {
        continue;
      }
      const sessionId = meta.session_id || (meta.worktree && latestSessionIn(db, meta.worktree));
      if (!sessionId) continue; // unattributable — skip, don't invent
      const ev = {
        id: `goalpass:${topic.name}/${f}`,
        session_id: sessionId,
        worktree: meta.worktree || null,
        topic: topic.name,
        ts: fs.statSync(path.join(dir, f)).mtimeMs,
        type: 'goal_pass',
      };
      if (ingestEvent(db, ev)) n++;
    }
  }
  return n;
}

/**
 * Verification evidence: .md or .json files whose name carries the worktree as wt-<name>; attributed the same way
 * as pass markers and SKIPPED when unattributable — evidence must never create a lane.
 * @param {Database} db
 * @param {string} root the repo
 * @param {string} folder the evidence folder, relative to the repo
 * @returns {number} events newly ingested
 */
function scanVerify(db, root, folder) {
  const dir = path.join(root, folder);
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(dir).filter((f) => /\.(md|json)$/.test(f) && !/^INDEX/i.test(f))) {
    const wtGuess = (f.match(/(?:^|[-_.])wt-([\w-]+)/) || [])[1] || null;
    const sessionId = wtGuess && latestSessionIn(db, wtGuess);
    if (!sessionId) continue; // unattributable — skip
    const ev = { id: `verify:${f}`, session_id: sessionId, ts: fs.statSync(path.join(dir, f)).mtimeMs, type: 'verify' };
    if (ingestEvent(db, ev)) n++;
  }
  return n;
}

/**
 * @param {unknown} v a folder setting
 * @returns {v is string} whether it names a folder
 */
function named(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * The pollable unit; a setInterval wraps it in server.js.
 * @param {Database} db
 * @param {{root?: string, pipeline?: PipelineSettings|null}} [opts] the repo (default: the working folder) and
 *   its "pipeline" settings
 * @returns {number} events newly ingested
 */
function scanOnce(db, { root = process.cwd(), pipeline } = {}) {
  const p = pipeline || {};
  return (
    (named(p.passMarkers) ? scanGatePass(db, root, p.passMarkers) : 0) +
    (named(p.goalMarkers) ? scanGoalPass(db, root, p.goalMarkers) : 0) +
    (named(p.evidence) ? scanVerify(db, root, p.evidence) : 0)
  );
}

module.exports = { scanOnce, scanGatePass, scanGoalPass, scanVerify };
