// Three pins, all one idea: **absent is not zero.**
//
// Each guards against a legitimate-looking number built from no data — the failure mode a
// null check cannot catch, because the value IS a number. On a dashboard whose only
// job is to be trustworthy, a confident wrong figure is worse than a blank one.

const { openDb } = require('../../../server/db');
const { buildPipeline } = require('../../../server/pipelineApi');

// ── a denominator for a phase nobody entered ─────────────────────────────────
test('the phase denominator counts recorded activity, not the furthest phase detected', () => {
  // current_phase is the furthest phase any event IMPLIED. A backfilled transcript
  // with only a session_start and a `gh pr create` lands on phase 7, and the old
  // rule counted it into Brainstorm, OpenSpec and Plan — phases where it recorded
  // nothing. Across 232 sessions that rendered "n=200" beside a row of dashes.
  const db = openDb(':memory:');
  const now = Date.now();
  db.prepare(
    `INSERT INTO sessions (id,worktree,current_phase,state,started_at,last_seen)
              VALUES ('s','wt',7,'working',0,?)`
  ).run(now);
  db.prepare(
    `INSERT INTO phase_stats (session_id,phase,work_ms,wait_ms,inputs)
              VALUES ('s',1,500,700,3)`
  ).run();
  const agg = buildPipeline(db, { now }).aggregate;

  expect(agg[0].sessions).toBe(1);
  for (const p of [2, 3, 4, 5, 6, 7]) {
    expect(agg[p - 1].sessions).toBe(0); // no activity recorded → not a denominator
    expect(agg[p - 1].inputs).toBe(0); // and the numerator beside it agrees
  }
  db.close();
});

test('a phase whose only recorded activity is tokens still counts', () => {
  // Narrowing the rule to work/wait/inputs survives the test above, because that
  // fixture records time. A phase can legitimately have spend and no measured
  // minutes, and dropping it would put a dash where a number belongs.
  const db = openDb(':memory:');
  const now = Date.now();
  db.prepare(
    `INSERT INTO sessions (id,worktree,current_phase,state,started_at,last_seen)
              VALUES ('t','wt',3,'working',0,?)`
  ).run(now);
  db.prepare(
    `INSERT INTO phase_stats (session_id,phase,work_ms,wait_ms,inputs,tokens_usd,tokens)
              VALUES ('t',3,0,0,0,0.5,120)`
  ).run();
  expect(buildPipeline(db, { now }).aggregate[2].sessions).toBe(1);
  db.close();
});

test('a phase with only sub-cent-rounding spend is NOT counted, matching the dash the client shows', () => {
  // The counter and the client's "empty" test must agree on the same rounded
  // value, or the row reads n=1 beside a full row of dashes.
  const db = openDb(':memory:');
  const now = Date.now();
  db.prepare(
    `INSERT INTO sessions (id,worktree,current_phase,state,started_at,last_seen)
              VALUES ('u','wt',4,'working',0,?)`
  ).run(now);
  db.prepare(
    `INSERT INTO phase_stats (session_id,phase,work_ms,wait_ms,inputs,tokens_usd,tokens)
              VALUES ('u',4,0,0,0,0.00001,0)`
  ).run();
  const agg = buildPipeline(db, { now }).aggregate[3];
  expect(agg.tokens_usd).toBe(0); // rounds away in the payload...
  expect(agg.sessions).toBe(0); // ...so it must not be a denominator either
  db.close();
});
