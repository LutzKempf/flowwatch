const fs = require('fs');
const path = require('path');
const { readAppSessions } = require('./appSessions');
const { readTranscriptTail } = require('./transcriptTail');
const { quoteOf } = require('./quote');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 14;
// The categories session titles use come from the repo's MISSION.md; the caller passes them in. A repo
// with none leaves every session uncategorised.

/** @type {(s: unknown) => string} */
const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[\s_-]/g, '');

/**
 * The worktree folder a session runs in — the name the board keys sessions by. Mirrors
 * hooks/lib/mapHookEvent.js worktreeOf exactly, including 'unknown' for a missing cwd (a parity test
 * holds the two together); a disagreement here would silently cost every phase join.
 * @param {string} cwd session working directory
 * @returns {string} worktree folder name
 */
function worktreeOf(cwd) {
  if (!cwd) return 'unknown';
  const parts = String(cwd).replace(/\\/g, '/').split('/').filter(Boolean);
  const i = parts.lastIndexOf('worktrees');
  return i >= 0 && parts[i + 1] ? parts[i + 1] : parts[parts.length - 1];
}

/**
 * Transcript files per CLI session id, from the Claude projects directory.
 * @param {string} projectsDir the projects root
 * @returns {{index: Map<string, string[]>, readable: boolean}}
 */
function transcriptIndex(projectsDir) {
  /** @type {Map<string, string[]>} */
  const index = new Map();
  let dirs;
  try {
    dirs = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return { index, readable: false };
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    let files;
    try {
      files = fs.readdirSync(path.join(projectsDir, d.name));
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const id = f.slice(0, -6);
      if (!index.has(id)) index.set(id, []);
      /** @type {string[]} */ (index.get(id)).push(path.join(projectsDir, d.name, f));
    }
  }
  return { index, readable: true };
}

/**
 * @typedef {{work_ms: number, wait_ms: number, inputs: number, tokens: number}} Totals
 * @typedef {{id: string, phase: number, totals: Totals|null}} BoardRow
 */

/**
 * What the board knows about a session: its phase, and its work/token totals.
 *
 * The board's own row id IS the CLI session id, so that is the join. Worktree is only the fallback,
 * and a worktree is reused across sessions in this repo — so the fallback takes the newest row and
 * says it was matched that way, because a recycled worktree would otherwise show a previous
 * session's phase as if it were this one's.
 * @param {import('better-sqlite3').Database} db open pipeline db
 * @returns {{byId: Map<string, BoardRow>, byWorktree: Map<string, BoardRow>}}
 */
function boardIndex(db) {
  const rows = /** @type {Array<{id: string, worktree: string, current_phase: number}>} */ (
    db.prepare('SELECT id, worktree, current_phase, last_seen FROM sessions ORDER BY last_seen DESC').all()
  );
  /** @type {Map<string, Totals>} */
  const totals = new Map();
  const stats = /** @type {Array<Totals & {session_id: string}>} */ (
    db.prepare('SELECT session_id, work_ms, wait_ms, inputs, tokens FROM phase_stats').all()
  );
  for (const r of stats) {
    const t = totals.get(r.session_id) || { work_ms: 0, wait_ms: 0, inputs: 0, tokens: 0 };
    t.work_ms += r.work_ms || 0;
    t.wait_ms += r.wait_ms || 0;
    t.inputs += r.inputs || 0;
    t.tokens += r.tokens || 0;
    totals.set(r.session_id, t);
  }
  /** @type {Map<string, BoardRow>} */
  const byId = new Map();
  /** @type {Map<string, BoardRow>} */
  const byWorktree = new Map();
  for (const r of rows) {
    const row = { id: r.id, phase: r.current_phase, totals: totals.get(r.id) || null };
    byId.set(String(r.id), row);
    if (!byWorktree.has(String(r.worktree))) byWorktree.set(String(r.worktree), row); // newest wins
  }
  return { byId, byWorktree };
}

/** @param {Record<string, any>} app app record @returns {{status:string, numbers:number[]}} */
function prOf(app) {
  const list = Array.isArray(app.prs)
    ? app.prs.map((p) => ({ n: p.prNumber, state: String(p.state || '').toUpperCase() }))
    : [];
  if (!list.length && app.prNumber) list.push({ n: app.prNumber, state: String(app.prState || '').toUpperCase() });
  const status = list.some((p) => p.state === 'OPEN')
    ? 'open'
    : list.some((p) => p.state === 'MERGED')
      ? 'merged'
      : list.length
        ? 'closed'
        : 'none';
  return { status, numbers: list.map((p) => p.n).filter(Boolean) };
}

/**
 * The category a session belongs to: the title's prefix when it names one, else whatever the
 * caller's inference says, else none. Never guessed from the phase or the folder alone.
 * @param {Record<string, any>} app app record
 * @param {(...sources: string[]) => any} inferCategory injected repo inference: a category, an object with
 *   one ({category}), or null
 * @param {string[]} [categories] the repo's categories, from its MISSION.md
 * @returns {{category: string|null, from: 'title prefix'|'inferred'|null}}
 */
function categoryOf(app, inferCategory, categories = []) {
  const m = String(app.title || '').match(/^\s*([A-Za-z][A-Za-z0-9_-]{1,24})\s*:/);
  const prefix = m && categories.find((c) => norm(c) === norm(m[1]));
  if (prefix) return { category: prefix, from: 'title prefix' };
  let inferred;
  try {
    inferred = inferCategory(app.branch, app.title);
  } catch {
    inferred = null;
  }
  if (inferred && typeof inferred === 'object') inferred = inferred.category || null;
  return inferred ? { category: inferred, from: 'inferred' } : { category: null, from: null };
}

/**
 * Everything waiting on the operator right now: one item per live session that handed the turn back,
 * stopped mid-turn, or errored, with what a row needs to be decidable without opening the session.
 *
 * `sources` says whether the two inputs could be read at all. An empty list with an unreadable
 * source means "cannot see", not "nothing waiting", and the page has to be able to tell them apart.
 * `records_folder` says whether the app's records folder was there at all, and where it was looked for.
 * @param {import('better-sqlite3').Database} db open pipeline db (phase and totals come from it)
 * @param {{appDir:string|null, appLooked?:string, projectsDir:string, repoRoot:string, now?:number, windowDays?:number,
 *   inferCategory?:(...s:string[])=>any, categories?:string[]}} opts `appLooked`: where the records were
 *   looked for, in words (appRecordsDir); `categories`: the repo's own, from its MISSION.md — the payload carries
 *   them, so the page offers the same list it was sorted by
 * @returns {{generated_at:number, window_days:number, sources:object, records_folder:object, categories:string[],
 *   items:Array<object>}}
 */
function buildInbox(
  db,
  {
    appDir,
    appLooked = 'looked in ' + appDir,
    projectsDir,
    repoRoot,
    now = Date.now(),
    windowDays = DEFAULT_WINDOW_DAYS,
    inferCategory = () => null,
    categories = [],
  } = /** @type {any} */ ({})
) {
  const since = now - windowDays * DAY_MS;
  const app = readAppSessions({ dir: appDir, repoRoot, since });
  const transcripts = transcriptIndex(projectsDir);
  const board = boardIndex(db);

  const items = [];
  for (const rec of app.records) {
    const files = [rec.cliSessionId, ...(rec.priorCliSessionIds || [])].flatMap(
      (id) => transcripts.index.get(id) || []
    );
    const tail = readTranscriptTail(files, { now });
    if (!tail) continue;
    if (now - tail.lastActivity > windowDays * DAY_MS) continue;
    // A session whose last turn errored is stopped, not busy: dropping it as "still working" would
    // hide it for the whole staleness window, and that is exactly what the operator must see. The
    // app records its own failures separately from the API's, and both mean broken.
    const appError = !!rec.error;
    if (tail.state === 'working' && !tail.apiError && !appError) continue;

    const worktree = worktreeOf(rec.cwd || rec.originCwd);
    const known = board.byId.get(String(rec.cliSessionId)) || board.byWorktree.get(worktree) || null;
    const phaseFrom = !known ? null : board.byId.has(String(rec.cliSessionId)) ? 'board' : 'board by worktree';
    // A routine run has no lane, as in the lanes payload: its title names the routine, not the work.
    const routine = !!rec.scheduledTaskId;
    const { category, from } = routine ? { category: null, from: null } : categoryOf(rec, inferCategory, categories);
    const quote = quoteOf(tail.finalText);
    items.push({
      key: tail.messageId,
      session_id: rec.sessionId || null,
      cli_session_id: rec.cliSessionId,
      title: rec.title || '(untitled)',
      routine,
      branch: rec.branch || null,
      worktree,
      category,
      category_from: from,
      phase: known ? known.phase : null,
      phase_from: phaseFrom,
      totals: known ? known.totals : null,
      state: tail.state,
      since: new Date(tail.lastActivity).toISOString(),
      hours_waiting: Math.round((now - tail.lastActivity) / 36e5),
      pr: prOf(rec),
      pending_question: tail.pendingQuestion,
      asks: quote.asks,
      asks_from: quote.asks_from,
      api_error: tail.apiError,
      app_error: appError,
      last_ask: quote.text,
    });
  }
  items.sort((a, b) => Date.parse(b.since) - Date.parse(a.since));
  return {
    generated_at: now,
    window_days: windowDays,
    sources: {
      app_records: app.readable ? 'ok' : 'unreadable',
      transcripts: transcripts.readable ? 'ok' : 'unreadable',
    },
    records_folder: { found: app.found, looked: appLooked },
    categories,
    items,
  };
}

module.exports = { buildInbox, worktreeOf, categoryOf, DEFAULT_WINDOW_DAYS };
