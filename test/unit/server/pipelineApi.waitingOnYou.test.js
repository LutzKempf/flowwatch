// "Waiting on you" must count every session that stopped and handed the turn back.
// Two ways to get it wrong, each enough to read zero on a board full of waiting sessions:
//
//  * Reading sessions.state. The column is declared `state TEXT DEFAULT 'working'`, so
//    any row the ingest does not write reads 'working'.
//  * Replacing the state with 'stale' for any session idle more than five minutes:
//    most sessions on a board are older than that, so no waiting state would reach
//    the counter.
//
// State is derived from the event stream, which already carries the answer: the
// rollup's wait_ms accumulates from a turn_stop to the next user_prompt, so a session
// whose newest turn_stop is not followed by a prompt is, by that same definition,
// waiting on the operator.
//
// Staleness stays a SEPARATE fact. Being idle for a week does not stop a session
// waiting on you; it means it has been waiting a week. Collapsing the two is what
// produced a zero.
const { openDb } = require('../../../server/db');
const { ingestEvent } = require('../../../server/ingest');
const { buildPipeline } = require('../../../server/pipelineApi');

const NOW = Date.parse('2026-09-09T12:00:00.000Z');
const ago = (min) => NOW - min * 60000;

let seq = 0;
function ev(db, sessionId, type, ts, extra = {}) {
  ingestEvent(db, { id: `e${++seq}`, session_id: sessionId, worktree: 'w', ts, type, ...extra });
}
const only = (out, id) => out.sessions.find((s) => s.id === id);

describe('deriving waiting-on-you from the event stream', () => {
  test('a session whose last event is a turn stop is waiting on you', () => {
    const db = openDb(':memory:');
    ev(db, 's1', 'user_prompt', ago(30));
    ev(db, 's1', 'bash', ago(25), { command: 'npm test' });
    ev(db, 's1', 'turn_stop', ago(20));
    expect(only(buildPipeline(db, { now: NOW }), 's1').state).toBe('waiting');
    db.close();
  });

  // The fixtures below stay INSIDE the staleness threshold on purpose: they are
  // about the handoff, and a stale never-stopped session is 'abandoned' rather than
  // 'working' (pipelineApi.abandonedSessions.test.js owns that distinction).
  test('a session re-prompted after its turn stop is working again', () => {
    const db = openDb(':memory:');
    ev(db, 's1', 'turn_stop', ago(4));
    ev(db, 's1', 'user_prompt', ago(1));
    expect(only(buildPipeline(db, { now: NOW }), 's1').state).toBe('working');
    db.close();
  });

  test('a session that never stopped is working', () => {
    const db = openDb(':memory:');
    ev(db, 's1', 'user_prompt', ago(3));
    ev(db, 's1', 'bash', ago(1), { command: 'npm test' });
    expect(only(buildPipeline(db, { now: NOW }), 's1').state).toBe('working');
    db.close();
  });

  test('token telemetry arriving after the stop does not mask it', () => {
    // statusLine pushes token_usage independently of the turn boundary, so a live
    // session's newest row is often token_usage. Reading "the last event type" would
    // call that working and reproduce the original zero.
    const db = openDb(':memory:');
    ev(db, 's1', 'turn_stop', ago(20));
    ev(db, 's1', 'token_usage', ago(19), { costUsd: 0.4 });
    expect(only(buildPipeline(db, { now: NOW }), 's1').state).toBe('waiting');
    db.close();
  });

  test('a stop and a prompt at the same instant resolve to working', () => {
    // Ties go to the operator having already replied: the prompt is what the agent
    // will act on next, so the ball is not with the operator.
    const db = openDb(':memory:');
    ev(db, 's1', 'turn_stop', ago(1));
    ev(db, 's1', 'user_prompt', ago(1));
    expect(only(buildPipeline(db, { now: NOW }), 's1').state).toBe('working');
    db.close();
  });
});

describe('staleness and waiting are independent facts', () => {
  test('a long-idle stopped session is still reported as waiting', () => {
    const db = openDb(':memory:');
    ev(db, 'old', 'turn_stop', ago(60 * 24 * 3)); // stopped three days ago
    const s = only(buildPipeline(db, { now: NOW }), 'old');
    expect(s.state).toBe('waiting');
    expect(s.stale).toBe(true);
    db.close();
  });

  test('a freshly stopped session is waiting and not yet stale', () => {
    const db = openDb(':memory:');
    ev(db, 'fresh', 'turn_stop', ago(1));
    const s = only(buildPipeline(db, { now: NOW }), 'fresh');
    expect(s.state).toBe('waiting');
    expect(s.stale).toBe(false);
    db.close();
  });

  test('a long-idle session that never stopped is abandoned, not waiting', () => {
    // It never handed the turn back, so it is not the operator's move — and it has
    // not done anything for days, so it is not working either.
    const db = openDb(':memory:');
    ev(db, 'abandoned', 'bash', ago(60 * 24 * 3), { command: 'npm test' });
    const s = only(buildPipeline(db, { now: NOW }), 'abandoned');
    expect(s.state).toBe('abandoned');
    expect(s.stale).toBe(true);
    db.close();
  });
});

test('the count of waiting sessions is what the operator sees', () => {
  // The headline number on the board. Three stopped, one re-prompted, one still
  // running: the answer is three, whatever the ages are.
  const db = openDb(':memory:');
  ev(db, 'a', 'turn_stop', ago(10));
  ev(db, 'b', 'turn_stop', ago(60 * 24 * 5));
  ev(db, 'c', 'turn_stop', ago(2));
  ev(db, 'd', 'turn_stop', ago(40));
  ev(db, 'd', 'user_prompt', ago(5));
  ev(db, 'e', 'bash', ago(3), { command: 'npm test' });
  const waiting = buildPipeline(db, { now: NOW, maxAgeDays: 0 }).sessions.filter((s) => s.state === 'waiting');
  expect(waiting.map((s) => s.id).sort()).toEqual(['a', 'b', 'c']);
  db.close();
});
