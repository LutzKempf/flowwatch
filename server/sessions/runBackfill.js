const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseTranscript } = require('./transcriptParse');
const { ingestEvent } = require('../ingest');

/**
 * Deterministic backfill event id: the same transcript re-walked yields the
 * same ids, so re-running the backfill is a no-op (ingest dedupes by id).
 * @param {string} sessionId transcript basename
 * @param {{ts:number, type:string, command?:string, name?:string}} ev parsed event
 * @param {number} i event index within the transcript
 * @returns {string}
 */
function stableId(sessionId, ev, i) {
  return (
    'bf:' +
    crypto
      .createHash('sha1')
      .update(`${sessionId}|${ev.ts}|${ev.type}|${ev.command || ev.name || ''}|${i}`)
      .digest('hex')
      .slice(0, 16)
  );
}

// What the transcript reader turned into file_change events before it learnt to see plans in a plans/ folder
// (Flowwatch 1.0.5). An event id counts only events the reader could always see, and an event it learnt to see
// later -- a plan write outside this rule, a question and its answer (1.0.7) -- is identified by its content
// instead: otherwise every event after the first new one would get a new id on the next walk, and be filed twice.
const FILE_SIGNAL_BEFORE_PLANS = /(openspec\/changes\/|tasks\.md$)/;

/**
 * @param {{type: string, path?: string}} ev a parsed event
 * @returns {boolean} whether the reader learnt to see this kind of event after ids were first handed out
 */
const seenSince = (ev) =>
  (ev.type === 'file_change' && !FILE_SIGNAL_BEFORE_PLANS.test(String(ev.path))) ||
  ev.type === 'waiting' ||
  ev.type === 'answered';

// What a session the hooks recorded live takes from its transcript: what the hooks did not report. Token figures
// they never carry; file writes, questions and answers they did not report before 1.0.5 and 1.0.7. None of these
// is counted twice if the hooks report it too: the first two count nothing, and a pause announced twice is one pause.
const LIVE_TAKES = new Set(['token_usage', 'file_change', 'waiting', 'answered']);

/**
 * Id of an event the reader learnt to see later: by content, so its position changes nothing else's. A plan write
 * keeps the id 1.0.5 gave it.
 * @param {string} sessionId transcript basename
 * @param {{ts:number, type:string, path?:string}} ev parsed event
 * @returns {string}
 */
function contentId(sessionId, ev) {
  const plan = ev.type === 'file_change';
  const key = plan ? `${sessionId}|${ev.ts}|${ev.path}` : `${sessionId}|${ev.ts}|${ev.type}`;
  return (plan ? 'bf:plan:' : 'bf:' + ev.type + ':') + crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
}

/**
 * Which folders of a Claude Code projects dir belong to a repo. Claude Code names a project folder after its
 * working path with every non-alphanumeric character a dash, so the repo's checkout is its slug and each
 * worktree under .claude/worktrees/ is `<slug>--claude-worktrees-<name>`; a sibling repo sharing a prefix
 * ("<slug>-2") is not the repo.
 * @param {string} repoRoot the repo's canonical checkout
 * @returns {(dirName: string) => boolean}
 */
function projectDirFilter(repoRoot) {
  const slug = path.resolve(repoRoot).replace(/[^A-Za-z0-9]/g, '-');
  return (name) => name === slug || name.startsWith(slug + '--claude-worktrees-');
}

// root = a Claude Code projects dir: <root>/<projectSlug>/<sessionId>.jsonl
/**
 * Walks a Claude Code projects dir and ingests every transcript through the
 * SAME ingestEvent path live events use. Sessions gain origin='backfill', so the board can say their
 * data is partial.
 * @param {import('better-sqlite3').Database} db open pipeline db
 * @param {string} root projects dir root
 * @param {{keepProject?: (dirName: string) => boolean}} [opts] which project folders to walk (all when
 *   absent); the collector passes projectDirFilter(its repo), so it never imports another repo's sessions
 * @returns {number} count of newly ingested events (0 on a re-run)
 */
function backfillDir(db, root, { keepProject = () => true } = {}) {
  let ingested = 0;
  const deriveWorktree = (/** @type {string} */ dir) => {
    const m = path.basename(dir).match(/worktrees-([\w.-]+)$/);
    return m ? m[1] : path.basename(dir);
  };
  /** @type {(dir: string, top: boolean) => void} */
  const walk = (dir, top) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      // subagents/ holds subagent transcripts — parts of a PARENT session, never
      // sessions of their own; walking them would mint phantom pipeline lanes.
      // At the top, each folder is one project: only the repo's own are walked.
      if (e.isDirectory()) {
        if (e.name !== 'subagents' && (!top || keepProject(e.name))) walk(full, false);
        continue;
      }
      if (!e.name.endsWith('.jsonl')) continue;
      const sessionId = path.basename(e.name, '.jsonl');
      const worktree = deriveWorktree(dir);
      const events = parseTranscript(full, { session_id: sessionId, worktree });
      // The hooks already recorded a session that reported live: its prompts, commands and turns are on record
      // under their own ids, and the transcript describes the SAME session. Filing all of it again would file a
      // second copy of each — every prompt counted twice, a turn's minutes cut at a prompt that never happened.
      // So it takes only what the hooks did not report (LIVE_TAKES).
      const live = db.prepare("SELECT 1 FROM events WHERE session_id=? AND id NOT LIKE 'bf:%' LIMIT 1").get(sessionId);
      let i = 0;
      for (const ev of events) {
        const id = seenSince(ev) ? contentId(sessionId, ev) : stableId(sessionId, ev, i++);
        if (live && !LIVE_TAKES.has(ev.type)) continue;
        if (ingestEvent(db, { id, ...ev })) ingested++;
      }
      // Backfilled sessions are flagged so the board can badge their data as partial. A session that also reported
      // live is not partial, and re-walking its transcript must never say it is: only one whose every event came
      // from a transcript (those ids are prefixed `bf:`) is flagged.
      if (events.length) {
        db.prepare(
          "UPDATE sessions SET origin='backfill' WHERE id=? AND NOT EXISTS" +
            " (SELECT 1 FROM events WHERE session_id=? AND id NOT LIKE 'bf:%')"
        ).run(sessionId, sessionId);
      }
    }
  };
  if (fs.existsSync(root)) walk(root, true);
  return ingested;
}

module.exports = { backfillDir, stableId, projectDirFilter };
