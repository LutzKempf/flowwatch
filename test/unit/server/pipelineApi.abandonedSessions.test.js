// A session that did not end on a turn_stop is not necessarily working. With 'working'
// as the FALLBACK, a recording that simply stops — crash, kill, closed laptop — would
// report an agent mid-task: the board asserting activity from the absence of a signal.
//
// Three states now, and the distinction is only ever drawn for sessions that did NOT
// hand the turn back:
//   waiting   - a turn_stop with no later prompt. Age is irrelevant; a session that
//               stopped a week ago is still waiting on the operator.
//   working   - never stopped, and recent. An agent genuinely mid-task.
//   abandoned - never stopped, and gone quiet. The recording just ends.
const { openDb } = require('../../../server/db');
const { ingestEvent } = require('../../../server/ingest');
const { buildPipeline } = require('../../../server/pipelineApi');

const NOW = Date.parse('2026-09-09T12:00:00.000Z');
const STALE_MS = 5 * 60 * 1000;
const ago = (min) => NOW - min * 60000;

let seq = 0;
function ev(db, sessionId, type, ts, extra = {}) {
  ingestEvent(db, { id: `e${++seq}`, session_id: sessionId, worktree: 'w', ts, type, ...extra });
}
const stateOf = (db, id, opts = {}) =>
  buildPipeline(db, { now: NOW, maxAgeDays: 0, ...opts }).sessions.find((s) => s.id === id).state;

describe('a session that never handed the turn back', () => {
  test('is abandoned once it has gone quiet', () => {
    const db = openDb(':memory:');
    ev(db, 's', 'user_prompt', ago(60 * 24 * 2));
    ev(db, 's', 'bash', ago(60 * 24 * 2), { command: 'npm test' });
    expect(stateOf(db, 's')).toBe('abandoned');
    db.close();
  });

  test('is still working while it is fresh', () => {
    const db = openDb(':memory:');
    ev(db, 's', 'user_prompt', ago(2));
    ev(db, 's', 'bash', ago(1), { command: 'npm test' });
    expect(stateOf(db, 's')).toBe('working');
    db.close();
  });

  test('flips at the staleness threshold, not at some second timer', () => {
    const db = openDb(':memory:');
    ev(db, 'fresh', 'bash', NOW - STALE_MS + 1000, { command: 'npm test' });
    ev(db, 'gone', 'bash', NOW - STALE_MS - 1000, { command: 'npm test' });
    const out = buildPipeline(db, { now: NOW, maxAgeDays: 0, staleMs: STALE_MS });
    expect(out.sessions.find((s) => s.id === 'fresh').state).toBe('working');
    expect(out.sessions.find((s) => s.id === 'gone').state).toBe('abandoned');
    db.close();
  });
});

describe('a session that DID hand the turn back is never abandoned', () => {
  test('a week-old stop is still waiting, not abandoned', () => {
    // The whole point of the previous fix. Age must not reclassify a real handoff.
    const db = openDb(':memory:');
    ev(db, 's', 'turn_stop', ago(60 * 24 * 7));
    expect(stateOf(db, 's')).toBe('waiting');
    db.close();
  });

  test('a fresh stop is waiting too', () => {
    const db = openDb(':memory:');
    ev(db, 's', 'turn_stop', ago(1));
    expect(stateOf(db, 's')).toBe('waiting');
    db.close();
  });

  test('a stale session re-prompted but not yet stopped again is abandoned', () => {
    // The operator replied and the agent never came back: not waiting on the
    // operator any more, and not working either.
    const db = openDb(':memory:');
    ev(db, 's', 'turn_stop', ago(60 * 24 * 3));
    ev(db, 's', 'user_prompt', ago(60 * 24 * 2));
    expect(stateOf(db, 's')).toBe('abandoned');
    db.close();
  });
});

test('the three states partition the board', () => {
  // Every lane lands in exactly one bucket, and nothing falls through to a default.
  const db = openDb(':memory:');
  ev(db, 'waits', 'turn_stop', ago(60 * 24));
  ev(db, 'works', 'bash', ago(1), { command: 'npm test' });
  ev(db, 'gone', 'bash', ago(60 * 24 * 4), { command: 'npm test' });
  const counts = buildPipeline(db, { now: NOW, maxAgeDays: 0 }).sessions.reduce(
    (acc, s) => ({ ...acc, [s.state]: (acc[s.state] || 0) + 1 }),
    {}
  );
  expect(counts).toEqual({ waiting: 1, working: 1, abandoned: 1 });
  db.close();
});

test('stale stays reported separately, so the dim is still available to the UI', () => {
  const db = openDb(':memory:');
  ev(db, 'gone', 'bash', ago(60 * 24), { command: 'npm test' });
  const s = buildPipeline(db, { now: NOW, maxAgeDays: 0 }).sessions.find((x) => x.id === 'gone');
  expect(s.state).toBe('abandoned');
  expect(s.stale).toBe(true);
  db.close();
});
