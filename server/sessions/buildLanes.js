const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildPipeline } = require('../pipelineApi');
const { parseSpecsDir } = require('../repo/specParser');
const { parseChanges } = require('../repo/changesParser');
const { ownerTable } = require('./capabilityLane');
const { placeWork, storyTouchTimes } = require('./laneWork');
const { readAppSessions } = require('./appSessions');
const { categoryOf, DEFAULT_WINDOW_DAYS } = require('./buildInbox');

/**
 * @typedef {{work_ms: number, wait_ms: number, tokens: number, inputs: number}} Totals
 * @type {(list: Array<Partial<Totals>>) => Totals}
 */
const sumTotals = (list) =>
  list.reduce(
    (/** @type {Totals} */ t, p) => ({
      work_ms: t.work_ms + (p.work_ms || 0),
      wait_ms: t.wait_ms + (p.wait_ms || 0),
      tokens: t.tokens + (p.tokens || 0),
      inputs: t.inputs + (p.inputs || 0),
    }),
    { work_ms: 0, wait_ms: 0, tokens: 0, inputs: 0 }
  );

/**
 * One lane per category with the board's current sessions in it.
 *
 * A session takes its title and category from its desktop-app record, joined on the board's id — which
 * is the record's CLI session id — and never on the worktree: worktrees are recycled, and the folder
 * alone names whichever session used it last. Its category follows the inbox's own rule (`categoryOf`),
 * so a session reads the same in the inbox and on its card.
 *
 * Two kinds of board session are counted, not laned. Scheduled-task runs, because a routine is not lane
 * work. And sessions with no app record at all — subagents and headless runs, stuck at phase 1 and ended
 * mid-turn — which would bury the real sessions in "No category". Both counts go on the page, so every
 * board session is accounted for.
 *
 * @param {{sessions?: Array<Record<string, any>>, records?: Array<Record<string, any>>,
 *   inferCategory?: (...sources: string[]) => any, now?: number,
 *   work?: Map<string|null, import('./laneWork').LaneWork>, categories?: string[]}} input
 *   `sessions` from buildPipeline; `records` from readAppSessions({ all: true }); `work` from placeWork
 * @returns {{lanes: Array<{name: string|null, waiting: number, totals: Totals, sessions: object[]} &
 *   import('./laneWork').LaneWork>, titles: Object<string, object>, routine_runs: number,
 *   without_app_record: number, earlier_parts: number}}
 */
function buildLanes({ sessions = [], records = [], inferCategory = () => null, work = new Map(), categories = [] }) {
  // A record answers for its current CLI id and for the earlier ids of the same conversation: the app
  // continues a conversation that ran out of context under a new id and keeps the old ones as prior ids.
  const byId = new Map();
  for (const r of records) {
    for (const id of [r.cliSessionId, ...(r.priorCliSessionIds || [])]) if (id != null) byId.set(String(id), r);
  }
  // One row per conversation: its most recently seen part. The earlier parts are counted, not shown.
  const current = sessions.filter((s) => s && !s.archived);
  const latest = new Map();
  let withoutRecord = 0;
  for (const s of current) {
    const rec = byId.get(String(s.id));
    if (!rec) {
      withoutRecord += 1;
      continue;
    }
    const seen = latest.get(rec);
    if (!seen || (s.last_seen || 0) > (seen.last_seen || 0)) latest.set(rec, s);
  }
  const earlierParts = current.length - withoutRecord - latest.size;
  /** @type {Map<string|null, Array<Record<string, any>>>} */
  const lanes = new Map();
  /** @type {Object<string, object>} */
  const titles = {};
  let routineRuns = 0;
  for (const [rec, s] of latest) {
    const cat = categoryOf(rec, inferCategory, categories);
    // The Session × phase board names every current session it can, scheduled runs included.
    // The branch and the category's source: every board row can be sorted and handed to Cleanup.
    titles[s.id] = {
      title: rec.title || s.worktree,
      app_session_id: rec.sessionId || null,
      app_archived: !!rec.isArchived,
      branch: rec.branch || null,
      category: rec.scheduledTaskId ? null : cat.category,
      category_from: rec.scheduledTaskId ? null : cat.from,
    };
    if (rec.scheduledTaskId) {
      routineRuns += 1;
      continue;
    }
    const row = {
      id: s.id,
      worktree: s.worktree,
      title: rec.title || s.worktree,
      app_session_id: rec.sessionId || null,
      app_archived: !!rec.isArchived,
      branch: rec.branch || null,
      category: cat.category,
      category_from: cat.from,
      state: s.state,
      stale: s.stale,
      origin: s.origin || 'live',
      phase: s.current_phase,
      last_seen: s.last_seen,
      phases: s.phases || [],
      totals: sumTotals(s.phases || []),
    };
    if (!lanes.has(row.category)) lanes.set(row.category, []);
    /** @type {Array<Record<string, any>>} */ (lanes.get(row.category)).push(row);
  }
  // A lane has a card when it has sessions, specs or stories — a lane with specs and nothing running
  // is still a lane. Lanes come in the order MISSION.md lists its categories; one the repo's inference names
  // but MISSION.md does not goes after them, never away; "No category" (null) is last.
  const unlisted = [...new Set([...lanes.keys(), ...work.keys()])]
    .filter((n) => n != null && !categories.includes(n))
    .sort();
  const order = [...categories, ...unlisted, null];
  const ordered = order
    .filter((name) => lanes.has(name) || work.has(name))
    .map((name) => {
      const list = lanes.get(name) || [];
      const w = work.get(name) || { specs: [], stories: [], older_stories: 0, older: [] };
      return {
        name,
        waiting: list.filter((r) => r.state === 'waiting').length,
        totals: sumTotals(list.map((r) => r.totals)),
        sessions: list,
        specs: w.specs,
        stories: w.stories,
        older_stories: w.older_stories,
        older: w.older,
      };
    });
  return {
    lanes: ordered,
    titles,
    routine_runs: routineRuns,
    without_app_record: withoutRecord,
    earlier_parts: earlierParts,
  };
}

/**
 * The active openspec stories: topic, status, the capabilities their `specs/*.md` deltas touch, and
 * when git last touched their folder — one `git log` for all of them, not one per change.
 * @param {{changesDir: string|null, repoDir: string}} dirs
 * @returns {{stories: Array<{topic: string, status: string, capabilities: string[], touched_at: number|null}>,
 *   touched: 'git'|'unavailable'}}
 */
function readStories({ changesDir, repoDir }) {
  let active;
  try {
    ({ active } = parseChanges(changesDir));
  } catch {
    return { stories: [], touched: 'unavailable' };
  }
  let times = new Map();
  /** @type {'git'|'unavailable'} */
  let touched = 'git';
  try {
    times = storyTouchTimes(
      execFileSync(
        'git',
        ['-C', repoDir, 'log', '--since=60.days', '--format=%x00%ct', '--name-only', '--', 'openspec/changes'],
        { encoding: 'utf8', timeout: 10000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }
      )
    );
  } catch {
    touched = 'unavailable';
  }
  const stories = active.map((c) => ({
    topic: c.topic,
    status: c.status,
    capabilities: c.capabilities,
    touched_at: times.get(c.topic) || null,
  }));
  return { stories, touched };
}

// A skill name as a hand-off message's first line ("/<name>") and a folder under the skills folder: no path, no space.
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/**
 * The repo's cleanup skill (flowwatch.json "cleanup": { "skill": "<name>" }), and whether this box has it. Cleanup
 * hands picked items to a session running it; a hand-off to a skill that is not there starts a session with
 * nothing to do, so the page says so before anything is picked. No entry (or `false`) names none: the page then
 * offers the list to copy.
 * @param {*} entry flowwatch.json's "cleanup" value
 * @param {string} skillsDir the folder skills are installed in (~/.claude/skills)
 * @returns {{name: string|null, state: 'installed'|'missing'|'not-set'|'invalid'}}
 */
function cleanupSkillOf(entry, skillsDir) {
  if (entry === undefined || entry === null || entry === false) return { name: null, state: 'not-set' };
  const name = typeof entry === 'object' ? entry.skill : undefined;
  if (typeof name !== 'string' || !SKILL_NAME.test(name)) return { name: null, state: 'invalid' };
  return { name, state: fs.existsSync(path.join(skillsDir, name, 'SKILL.md')) ? 'installed' : 'missing' };
}

/**
 * Reads the board, the app records and the openspec tree, and builds the lanes payload.
 * @param {import('better-sqlite3').Database} db
 * @param {{appDir: string|null, repoRoot: string, inferCategory: (...sources: string[]) => any,
 *   specsDir: string|null, changesDir: string|null,
 *   repoDir: string, categories?: string[], categorySpecs?: Object<string, string[]>, cleanup?: *,
 *   skillsDir?: string, now?: number, windowDays?: number}} opts
 *   `repoRoot` scopes the app records (the canonical checkout) and is the folder a cleanup session opens
 *   in; `specsDir`/`changesDir`/`repoDir` are the collector's own checkout, the same tree Flowwatch
 *   reads; `categories`/`categorySpecs` are MISSION.md's; `cleanup` is flowwatch.json's entry (cleanupSkillOf).
 */
function readLanes(
  db,
  {
    appDir,
    repoRoot,
    inferCategory,
    specsDir,
    changesDir,
    repoDir,
    categories = [],
    categorySpecs = {},
    cleanup,
    skillsDir = path.join(os.homedir(), '.claude', 'skills'),
    now = Date.now(),
    windowDays = DEFAULT_WINDOW_DAYS,
  }
) {
  const board = buildPipeline(db, { now, maxAgeDays: windowDays });
  // Every record, not those active inside the window: lastActivityAt is the app's clock, the window is the
  // board's, and a session busy on the board can have a record last touched days ago. The id decides.
  const app = readAppSessions({ dir: appDir, repoRoot, all: true });
  const table = ownerTable(categorySpecs);
  const { stories, touched } = readStories({ changesDir, repoDir });
  let capabilities;
  try {
    capabilities = parseSpecsDir(specsDir).capabilities;
  } catch {
    capabilities = {};
  }
  const work = placeWork({ capabilities, stories, table, inferCategory, now });
  return {
    generated_at: now,
    window_days: windowDays,
    sources: { app_records: app.readable ? 'ok' : 'unreadable' },
    // Categories that own no spec are said, not silently replaced by inference for every spec.
    capability_lanes_from: table.exact.size || table.prefixes.length ? 'categories' : 'inference only',
    stories_touched_from: touched,
    cleanup_skill: cleanupSkillOf(cleanup, skillsDir),
    repo_root: repoRoot,
    categories,
    ...buildLanes({ sessions: board.sessions, records: app.records, inferCategory, now, work, categories }),
  };
}

module.exports = { buildLanes, readLanes, cleanupSkillOf };
