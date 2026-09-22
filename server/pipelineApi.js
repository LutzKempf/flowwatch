const { PHASE_COUNT } = require('./sessions/phases');

const DAY_MS = 24 * 60 * 60 * 1000;
// The board is a "who is where right now" view, not an archive, so the window is set
// by what stays scannable rather than by what is recent: on a busy repo, 30 or 60 days
// keep hundreds of lanes — neither is a board you can read.
// Override per request with ?days=, or box-wide with FLOWWATCH_MAX_AGE_DAYS; 0 = all.
const DEFAULT_MAX_AGE_DAYS = 14;

/**
 * @typedef {{phase: number, wait_ms: number, inputs: number, score?: number, target?: boolean}} ScoredPhase
 */

// The ★ automation-target formula. Summing wait_ms and inputs raw would leave single-digit input
// counts numerically inert against milliseconds of waiting, so each phase's score is the mean of its
// NORMALIZED wait share and NORMALIZED input share:
//   score(p) = (wait_ms[p]/max_wait + inputs[p]/max_inputs) / 2      (a zero max term drops out)
// The phase with the highest score gets target:true; ties break to the lower phase number.
// MUTATES the rows in place (adds score/target) and returns the same array — exported so
// the test can assert the RIGHT phase wins, not just that rows exist.
/**
 * @template {ScoredPhase} T
 * @param {T[]} aggregate per-phase totals (mutated in place)
 * @returns {T[]} the same array, each row gaining score and target fields
 */
function scoreAutomationTargets(aggregate) {
  const maxWait = Math.max(...aggregate.map((a) => a.wait_ms));
  const maxInputs = Math.max(...aggregate.map((a) => a.inputs));
  let best = -1,
    bestIdx = -1;
  for (const [i, a] of aggregate.entries()) {
    const parts = [];
    if (maxWait > 0) parts.push(a.wait_ms / maxWait);
    if (maxInputs > 0) parts.push(a.inputs / maxInputs);
    a.score = parts.length ? parts.reduce((x, y) => x + y, 0) / parts.length : 0;
    a.target = false;
    if (a.score > best) {
      best = a.score;
      bestIdx = i;
    }
  }
  if (bestIdx >= 0 && best > 0) aggregate[bestIdx].target = true;
  return aggregate;
}

/** @param {number} x */
function roundUsd(x) {
  return Math.round(x * 10000) / 10000;
}

/**
 * Whether each session handed the turn back to the operator.
 *
 * The sessions.state column is not read here: it says only whether the last event was a
 * turn_stop. The stream holds a stricter answer, the one the rollup uses for wait_ms: a
 * session whose newest turn_stop is not followed by a user_prompt has handed the turn back
 * and is waiting on the operator. Comparing those two timestamps — rather than reading "the
 * last event type" — keeps statusLine's token_usage rows, which arrive after a stop, from
 * reading as activity.
 * @param {import('better-sqlite3').Database} db open pipeline db
 * @returns {Map<string, boolean>} session id -> handed the turn back
 */
function handedBackStates(db) {
  const rows = /** @type {Array<{session_id: string, stopped_at: number|null, prompted_at: number|null}>} */ (
    db
      .prepare(
        `
    SELECT session_id,
           MAX(CASE WHEN type='turn_stop'   THEN ts END) AS stopped_at,
           MAX(CASE WHEN type='user_prompt' THEN ts END) AS prompted_at
      FROM events
     WHERE type IN ('turn_stop','user_prompt')
     GROUP BY session_id`
      )
      .all()
  );
  const out = new Map();
  for (const r of rows) {
    // A tie resolves to NOT handed back: the prompt is what the agent acts on next,
    // so the ball is not with the operator.
    out.set(r.session_id, r.stopped_at != null && (r.prompted_at == null || r.stopped_at > r.prompted_at));
  }
  return out;
}

/**
 * One of three lane states. The distinction between 'working' and 'abandoned' is
 * drawn ONLY for sessions that never handed the turn back. With 'working' as their
 * fallback, a recording that simply ends — crash, kill, closed laptop — would report
 * an agent mid-task: activity asserted from the absence of a signal.
 *
 * Age never reclassifies a real handoff: a session that stopped a week ago is still
 * waiting on the operator, which is the whole point of deriving 'waiting' at all.
 * @param {boolean} handedBack whether a turn_stop outlives the last user_prompt
 * @param {boolean} stale whether the session has gone quiet
 * @returns {'waiting'|'working'|'abandoned'}
 */
function laneState(handedBack, stale) {
  if (handedBack) return 'waiting';
  return stale ? 'abandoned' : 'working';
}

/**
 * Assembles the pipeline view: every session inside the age window, with its 12
 * per-phase stat rows, staleness flags, and the automation-target aggregate.
 *
 * The window bounds the SQL, not the render, so the aggregate is computed over
 * exactly the sessions the board draws — a rollup covering lanes the operator
 * cannot see is one they cannot reconcile.
 * @param {import('better-sqlite3').Database} db open pipeline db
 * @param {{now?: number, staleMs?: number, maxAgeDays?: number, archiveMs?: number}} [opts] clock
 *   override, staleness threshold, the session age window in days (0 = no window), and the age
 *   past which a session is archived
 */
function buildPipeline(
  db,
  { now, staleMs = 5 * 60 * 1000, maxAgeDays = DEFAULT_MAX_AGE_DAYS, archiveMs = 7 * 24 * 60 * 60 * 1000 } = {}
) {
  const clock = now != null ? now : Date.now();
  const windowDays = Number.isFinite(maxAgeDays) && maxAgeDays > 0 ? maxAgeDays : 0;
  /** @typedef {Record<string, any>} Row a database row */
  const sessions = /** @type {Row[]} */ (
    windowDays
      ? db
          .prepare('SELECT * FROM sessions WHERE last_seen >= ? ORDER BY last_seen DESC')
          .all(clock - windowDays * DAY_MS)
      : db.prepare('SELECT * FROM sessions ORDER BY last_seen DESC').all()
  );
  const handedBackById = handedBackStates(db);
  // ONE query for all stats (not 1+N per-session), grouped by session_id.
  /** @type {Map<string, Row[]>} */
  const statsBySession = new Map();
  for (const r of /** @type {Row[]} */ (db.prepare('SELECT * FROM phase_stats').all())) {
    if (!statsBySession.has(r.session_id)) statsBySession.set(r.session_id, []);
    /** @type {Row[]} */ (statsBySession.get(r.session_id)).push(r);
  }

  // Cross-session per-phase aggregate — high wait_ms + high inputs marks an automation target.
  /**
   * @type {Array<{phase: number, work_ms: number, wait_ms: number, inputs: number, tokens_usd: number,
   *   tokens: number, sessions: number, score?: number, target?: boolean}>}
   */
  const aggregate = [];
  for (let p = 1; p <= PHASE_COUNT; p++)
    aggregate.push({ phase: p, work_ms: 0, wait_ms: 0, inputs: 0, tokens_usd: 0, tokens: 0, sessions: 0 });

  const out = sessions.map((s) => {
    const isStale = clock - s.last_seen > staleMs;
    const rows = statsBySession.get(s.id) || [];
    const byPhase = new Map(rows.map((r) => [r.phase, r]));
    const phases = [];
    for (let p = 1; p <= PHASE_COUNT; p++) {
      const r = byPhase.get(p) || { work_ms: 0, wait_ms: 0, inputs: 0, tokens_usd: 0, tokens: 0 };
      phases.push({
        phase: p,
        work_ms: r.work_ms,
        wait_ms: r.wait_ms,
        inputs: r.inputs,
        tokens_usd: roundUsd(r.tokens_usd),
        tokens: r.tokens || 0,
      });
      const a = aggregate[p - 1];
      a.work_ms += r.work_ms;
      a.wait_ms += r.wait_ms;
      a.inputs += r.inputs;
      a.tokens_usd += r.tokens_usd;
      a.tokens += r.tokens || 0;
      // The denominator for this phase's totals: sessions that actually RECORDED
      // something here. `p <= current_phase` is the obvious rule and the wrong
      // one — current_phase is the furthest phase any event IMPLIED, so a
      // backfilled transcript with only a session_start and a `gh pr create` lands
      // on phase 7 and would be counted into Brainstorm, OpenSpec and Plan, where
      // it contributed no time and no inputs: a confident n beside a row of dashes.
      // Counting recorded activity keeps the denominator consistent with the
      // numerators printed next to it.
      // roundUsd on the usd term so this agrees with the client's own "empty" test,
      // which reads the ROUNDED aggregate value: a phase whose only activity is
      // under $0.00005 would otherwise be counted here and dashed there.
      if (r.work_ms || r.wait_ms || r.inputs || roundUsd(r.tokens_usd) || r.tokens) a.sessions += 1;
    }
    // Two orthogonal facts, deliberately not merged. `state` says what the session
    // is doing; `archived` says whether it is still relevant. Conflating them would
    // render dead transcripts as live 'working' lanes.
    //
    // State is DERIVED from the event stream (handedBackStates/laneState above), not
    // read from the sessions.state column, which only knows whether the last event
    // was a turn_stop — token_usage rows arrive after a stop and would read as activity.
    const age = clock - s.last_seen;
    const archived = age > archiveMs;
    return {
      id: s.id,
      worktree: s.worktree,
      milestone: s.milestone || 'unassigned',
      origin: s.origin || 'live',
      current_phase: s.current_phase,
      state: laneState(handedBackById.get(s.id) === true, isStale),
      // stale is still reported separately: it is what dims a lane, and 'waiting'
      // deliberately ignores it — a session idle for a week has not stopped waiting
      // on you, it has been waiting a week.
      last_seen: s.last_seen,
      stale: isStale,
      archived,
      phases,
    };
  });

  for (const a of aggregate) a.tokens_usd = roundUsd(a.tokens_usd);

  // Rollup over the ARCHIVED sessions. The lane board hides them; their measured
  // work/wait split and input count are the only real data anyone has about how
  // this development process actually spends time, so filtering the board must
  // never filter the analytics. `aggregate` above likewise stays over ALL sessions.
  const h = out.reduce(
    (acc, s) => {
      if (!s.archived) return acc;
      acc.sessions += 1;
      acc.worktrees.add(s.worktree);
      for (const p of s.phases) {
        acc.workMs += p.work_ms;
        acc.waitMs += p.wait_ms;
        acc.inputs += p.inputs;
      }
      return acc;
    },
    { sessions: 0, worktrees: new Set(), workMs: 0, waitMs: 0, inputs: 0 }
  );

  return {
    generated_at: clock,
    window_days: windowDays,
    sessions: out,
    history: {
      sessions: h.sessions,
      worktrees: h.worktrees.size,
      workMs: h.workMs,
      waitMs: h.waitMs,
      inputs: h.inputs,
    },
    aggregate: scoreAutomationTargets(aggregate),
  };
}

module.exports = { buildPipeline, scoreAutomationTargets, DEFAULT_MAX_AGE_DAYS };
