const { openDb } = require('../../../server/db');
const { ingestEvent } = require('../../../server/ingest');
const { buildPipeline } = require('../../../server/pipelineApi');

test('assembles sessions with phase stats and marks stale sessions', () => {
  const db = openDb(':memory:');
  ingestEvent(db, { id: 'a', session_id: 's1', worktree: 'w1', ts: 1000, type: 'session_start' });
  // now = far in the future so s1 is stale (last_seen 1000, threshold 5 min)
  const out = buildPipeline(db, { now: 1000 + 10 * 60 * 1000, staleMs: 5 * 60 * 1000 });
  const s1 = out.sessions.find((s) => s.id === 's1');
  expect(s1.current_phase).toBe(1);
  expect(s1.stale).toBe(true);
  expect(Array.isArray(s1.phases)).toBe(true);
  expect(s1.phases).toHaveLength(12);
  db.close();
});

test('cross-session per-phase aggregate — the "which phase do I automate next?" data', () => {
  const db = openDb(':memory:');
  ingestEvent(db, { id: 'a', session_id: 's1', worktree: 'w1', ts: 1000, type: 'session_start' });
  const out = buildPipeline(db, { now: 1000 + 10 * 60 * 1000, staleMs: 5 * 60 * 1000 });
  expect(out.aggregate).toHaveLength(12);
  // `sessions` counts sessions that RECORDED something at this phase, not sessions
  // whose detected phase is at least this one. A lone
  // session_start contributes no time and no inputs anywhere, so it is not a
  // denominator for anything — including phase 1's row of zeros.
  expect(out.aggregate[0]).toMatchObject({ phase: 1, work_ms: 0, wait_ms: 0, inputs: 0, tokens_usd: 0, sessions: 0 });
  db.close();
});

test('★-target picks the RIGHT phase — normalized, so single-digit inputs are not inert', () => {
  const { scoreAutomationTargets } = require('../../../server/pipelineApi');
  const agg = [
    { phase: 1, wait_ms: 100000, inputs: 1 }, // huge wait, one input
    { phase: 2, wait_ms: 60000, inputs: 9 }, // moderate wait, MANY inputs → the real target
    { phase: 3, wait_ms: 0, inputs: 0 },
  ];
  const scored = scoreAutomationTargets(agg);
  // raw summing would crown phase 1 (100001 > 60009); normalization must crown phase 2:
  // p1 = (1.0 + 1/9)/2 ≈ 0.556 ; p2 = (0.6 + 1.0)/2 = 0.8
  expect(scored.find((a) => a.target).phase).toBe(2);
  expect(scored.filter((a) => a.target)).toHaveLength(1);
});

test('tokens_usd is rounded to 4 decimals in phases[] and aggregate', () => {
  const db = openDb(':memory:');
  ingestEvent(db, { id: 'r1', session_id: 'sR', ts: 100, type: 'token_usage', costUsd: 0 });
  ingestEvent(db, { id: 'r2', session_id: 'sR', ts: 200, type: 'token_usage', costUsd: 0.12345678 });
  const out = buildPipeline(db, { now: 300 });
  const s = out.sessions.find((x) => x.id === 'sR');
  expect(s.phases[0].tokens_usd).toBe(0.1235);
  expect(out.aggregate[0].tokens_usd).toBe(0.1235);
  db.close();
});

// ─── archiving is DERIVED, state is WRITTEN ────────────────────────────────────
// A board where no session is ever finished keeps every lane it has ever seen.
// Archiving is derived from last_seen (not migrated) so the raw events survive.

const DAY = 24 * 60 * 60 * 1000;

test('a session untouched for more than 7 days is archived', () => {
  const db = openDb(':memory:');
  const now = Date.now();
  db.prepare(
    `INSERT INTO sessions (id,worktree,current_phase,state,started_at,last_seen)
              VALUES ('old','wt-old',7,'working',0,?)`
  ).run(now - 8 * DAY);
  db.prepare(
    `INSERT INTO sessions (id,worktree,current_phase,state,started_at,last_seen)
              VALUES ('new','wt-new',2,'waiting',0,?)`
  ).run(now);
  const out = buildPipeline(db, { now });
  expect(out.sessions.find((s) => s.id === 'old').archived).toBe(true);
  expect(out.sessions.find((s) => s.id === 'new').archived).toBe(false);
  db.close();
});

test('waiting does not decay into stale after 40 minutes', () => {
  // A turn_stop is a definitive signal, not a lost one. A session you have been
  // sitting on for 40 min is still waiting on YOU — reclassifying it as stale
  // would silently drop it out of the waiting-on-you count.
  //
  // Seeded as an EVENT, not as the state column: the state a lane reports is derived
  // from the stream (a turn_stop with no later user_prompt), which is what landed on
  // main. Staleness is then reported beside it rather than instead of it — the lane
  // still says 'waiting', and stale only dims it.
  const db = openDb(':memory:');
  const now = Date.now();
  const at = now - 40 * 60 * 1000;
  db.prepare(
    `INSERT INTO sessions (id,worktree,current_phase,state,started_at,last_seen)
              VALUES ('w','wt',3,'working',0,?)`
  ).run(at);
  db.prepare(`INSERT INTO events (session_id,ts,type) VALUES ('w',?,'turn_stop')`).run(at);
  const s = buildPipeline(db, { now }).sessions[0];
  expect(s.state).toBe('waiting');
  expect(s.stale).toBe(true); // an attribute of the lane, never its state
  expect(s.archived).toBe(false);
  db.close();
});

test('a non-waiting session past the stale threshold is still stale', () => {
  const db = openDb(':memory:');
  const now = Date.now();
  db.prepare(
    `INSERT INTO sessions (id,worktree,current_phase,state,started_at,last_seen)
              VALUES ('x','wt',3,'working',0,?)`
  ).run(now - 40 * 60 * 1000);
  expect(buildPipeline(db, { now }).sessions[0].stale).toBe(true);
  db.close();
});

test('an archived session is flagged archived, and the board drops it', () => {
  // Archiving is a band INSIDE the server's session-age window: older than archiveMs
  // (7d), younger than the window (14d). Past the window the server does not send the
  // session at all, so there is nothing left to archive.
  //
  // It is also stale, and that is not a contradiction any more: staleness is an age
  // fact reported beside the state, and an archived lane is never drawn — the page
  // filters it before rendering — so the two can never disagree on screen.
  const db = openDb(':memory:');
  const now = Date.now();
  db.prepare(
    `INSERT INTO sessions (id,worktree,current_phase,state,started_at,last_seen)
              VALUES ('old','wt',7,'working',0,?)`
  ).run(now - 8 * DAY);
  const s = buildPipeline(db, { now }).sessions[0];
  expect(s.archived).toBe(true);
  expect(s.state).toBe('abandoned'); // it never handed the turn back and went quiet
  db.close();
});

test('history counts ONLY archived sessions, so cleaning the board keeps the analytics', () => {
  // With a single archived session, "count everything" and "count only archived"
  // produce the same numbers and the test cannot tell them apart. The live session
  // below is what makes it discriminate — without it this is a proxy, not a test.
  const db = openDb(':memory:');
  const now = Date.now();
  db.prepare(
    `INSERT INTO sessions (id,worktree,current_phase,state,started_at,last_seen)
              VALUES ('old','wt-old',7,'working',0,?)`
  ).run(now - 8 * DAY);
  db.prepare(
    `INSERT INTO phase_stats (session_id,phase,work_ms,wait_ms,inputs)
              VALUES ('old',7,1000,9000,42)`
  ).run();
  db.prepare(
    `INSERT INTO sessions (id,worktree,current_phase,state,started_at,last_seen)
              VALUES ('live','wt-live',3,'waiting',0,?)`
  ).run(now);
  db.prepare(
    `INSERT INTO phase_stats (session_id,phase,work_ms,wait_ms,inputs)
              VALUES ('live',3,500,700,9)`
  ).run();

  const out = buildPipeline(db, { now });
  expect(out.history.sessions).toBe(1); // not 2
  expect(out.history.worktrees).toBe(1); // not 2
  expect(out.history.inputs).toBe(42); // not 51
  expect(out.history.workMs).toBe(1000); // not 1500
  expect(out.history.waitMs).toBe(9000); // not 9700
  db.close();
});

test('the automation aggregate still covers archived sessions', () => {
  // The whole value of the backfill is the process measurement. Filtering the
  // lane board must NOT filter the analytics.
  const db = openDb(':memory:');
  const now = Date.now();
  db.prepare(
    `INSERT INTO sessions (id,worktree,current_phase,state,started_at,last_seen)
              VALUES ('old','wt',7,'working',0,?)`
  ).run(now - 8 * DAY);
  db.prepare(
    `INSERT INTO phase_stats (session_id,phase,work_ms,wait_ms,inputs)
              VALUES ('old',7,1000,9000,42)`
  ).run();
  const out = buildPipeline(db, { now });
  expect(out.aggregate[6].inputs).toBe(42);
  db.close();
});
