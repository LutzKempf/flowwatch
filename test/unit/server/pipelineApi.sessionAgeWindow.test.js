// The session board shows the sessions inside an age window, not every session ever
// recorded: buildPipeline's query is bounded, not `SELECT * FROM sessions` with no WHERE.
//
// Two properties matter, and the second is the one a naive version gets wrong: the
// aggregate that drives the ★ automation target must be computed over the SAME
// window as the lanes, or the rollup silently reports on sessions the operator
// cannot see and cannot reconcile against.
const { openDb } = require('../../../server/db');
const { ingestEvent } = require('../../../server/ingest');
const { buildPipeline } = require('../../../server/pipelineApi');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-08T12:00:00.000Z');

/** Seeds one session whose last_seen sits `ageDays` before NOW. */
function seed(db, id, ageDays) {
  ingestEvent(db, { id: `e-${id}`, session_id: id, worktree: 'w', ts: NOW - ageDays * DAY, type: 'session_start' });
}

const ids = (out) => out.sessions.map((s) => s.id).sort();

// 14, not 60: the literal is pinned because it encodes a decision (a board you can
// read beats a board that is merely recent), not an implementation detail. Changing
// the default SHOULD fail here and be re-argued.
describe('the default 14-day window', () => {
  test('a session seen 13 days ago is shown, one seen 15 days ago is not', () => {
    const db = openDb(':memory:');
    seed(db, 'recent', 13);
    seed(db, 'ancient', 15);
    expect(ids(buildPipeline(db, { now: NOW }))).toEqual(['recent']);
    db.close();
  });

  test('exactly 14 days old is still inside the window', () => {
    const db = openDb(':memory:');
    seed(db, 'edge', 14);
    expect(ids(buildPipeline(db, { now: NOW }))).toEqual(['edge']);
    db.close();
  });

  test('a session just outside the old 60-day window is now excluded too', () => {
    const db = openDb(':memory:');
    seed(db, 'fiftyNine', 59);
    expect(ids(buildPipeline(db, { now: NOW }))).toEqual([]);
    db.close();
  });

  test('the window is reported in the payload, so the filter is never invisible', () => {
    const db = openDb(':memory:');
    seed(db, 'recent', 1);
    expect(buildPipeline(db, { now: NOW }).window_days).toBe(14);
    db.close();
  });
});

describe('the window is configurable', () => {
  test('a tighter window drops sessions the default would keep', () => {
    const db = openDb(':memory:');
    seed(db, 'day3', 3);
    seed(db, 'day10', 10);
    expect(ids(buildPipeline(db, { now: NOW, maxAgeDays: 7 }))).toEqual(['day3']);
    db.close();
  });

  test('a wider window brings back sessions the default hides', () => {
    const db = openDb(':memory:');
    seed(db, 'day3', 3);
    seed(db, 'day45', 45);
    expect(ids(buildPipeline(db, { now: NOW, maxAgeDays: 60 }))).toEqual(['day3', 'day45']);
    db.close();
  });

  test('0 disables the window entirely — the full history escape hatch', () => {
    const db = openDb(':memory:');
    seed(db, 'recent', 1);
    seed(db, 'ancient', 400);
    expect(ids(buildPipeline(db, { now: NOW, maxAgeDays: 0 }))).toEqual(['ancient', 'recent']);
    expect(buildPipeline(db, { now: NOW, maxAgeDays: 0 }).window_days).toBe(0);
    db.close();
  });
});

test('the ★-target aggregate counts only sessions inside the window', () => {
  // Without this, the rollup reports work the operator cannot see in any lane.
  const db = openDb(':memory:');
  seed(db, 'inside', 5);
  seed(db, 'outside', 200);
  // Both sessions need RECORDED activity in the phase, because a phase's denominator
  // counts sessions that measured something there rather than every session whose
  // current_phase is past it (a backfilled transcript otherwise lands in phases it
  // never touched). Without these rows both sides count 0 and the test cannot tell
  // the window apart from an empty rollup.
  for (const id of ['inside', 'outside']) {
    db.prepare(
      `UPDATE phase_stats SET work_ms=1000, wait_ms=2000, inputs=3
                 WHERE session_id=? AND phase=1`
    ).run(id); // the row ingest already made
  }
  const windowed = buildPipeline(db, { now: NOW });
  const full = buildPipeline(db, { now: NOW, maxAgeDays: 0 });
  expect(windowed.aggregate[0].sessions).toBe(1);
  expect(full.aggregate[0].sessions).toBe(2);
});

test('an empty window yields no lanes and a still-well-formed aggregate', () => {
  const db = openDb(':memory:');
  seed(db, 'ancient', 500);
  const out = buildPipeline(db, { now: NOW });
  expect(out.sessions).toEqual([]);
  expect(out.aggregate).toHaveLength(12);
  db.close();
});
