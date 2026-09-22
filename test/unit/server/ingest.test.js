const { openDb } = require('../../../server/db');
const { ingestEvent } = require('../../../server/ingest');
const { PHASE } = require('../../../server/sessions/phases');

test('ingest is idempotent by id and updates session phase + last_seen', () => {
  const db = openDb(':memory:');
  const e = { id: 'e1', session_id: 's1', worktree: 'w', ts: 1000, type: 'session_start' };
  ingestEvent(db, e);
  ingestEvent(db, e); // duplicate id — must be a no-op
  expect(db.prepare('SELECT COUNT(*) c FROM events').get().c).toBe(1);

  ingestEvent(db, { id: 'e2', session_id: 's1', ts: 2000, type: 'bash', command: 'gh pr create' });
  const s = db.prepare('SELECT * FROM sessions WHERE id=?').get('s1');
  expect(s.current_phase).toBe(PHASE.PR);
  expect(s.last_seen).toBe(2000);
  db.close();
});

test('rejects an event with no id or session_id', () => {
  const db = openDb(':memory:');
  expect(() => ingestEvent(db, { type: 'x' })).toThrow();
  db.close();
});

test('rejects an event whose ts is a string', () => {
  const db = openDb(':memory:');
  expect(() => ingestEvent(db, { id: 'b1', session_id: 's1', ts: '1000', type: 'session_start' })).toThrow();
  db.close();
});

test('rejects an event with a missing type', () => {
  const db = openDb(':memory:');
  expect(() => ingestEvent(db, { id: 'b2', session_id: 's1', ts: 1000 })).toThrow();
  db.close();
});

test('rejects an event with a missing ts', () => {
  const db = openDb(':memory:');
  expect(() => ingestEvent(db, { id: 'b3', session_id: 's1', type: 'session_start' })).toThrow();
  db.close();
});

test('a rejected event leaves the events table empty (nothing half-written)', () => {
  const db = openDb(':memory:');
  expect(() => ingestEvent(db, { id: 'b4', session_id: 's1', ts: 'oops', type: 'session_start' })).toThrow();
  expect(db.prepare('SELECT COUNT(*) c FROM events').get().c).toBe(0);
  db.close();
});

// Note: ingest runs insert+upsert+recompute in ONE better-sqlite3 transaction so a
// mid-recompute throw rolls back the event row — otherwise the id-dedupe would block
// every retry of that event forever. Validation above makes the throw path
// near-unreachable, so no cheaply-constructible dedicated test exists; the
// transaction itself is the guard.

test('same-ts events roll up in insertion order (stable rowid tiebreak)', () => {
  const db = openDb(':memory:');
  ingestEvent(db, { id: 't1', session_id: 'sT', ts: 0, type: 'session_start' });
  ingestEvent(db, { id: 't2', session_id: 'sT', ts: 1000, type: 'user_prompt' });
  ingestEvent(db, { id: 't3', session_id: 'sT', ts: 2000, type: 'turn_stop' });
  // skill FIRST, then a prompt at the IDENTICAL ts: pinned semantics say the
  // wait + input belong to the phase current when the prompt lands — BRAINSTORM.
  ingestEvent(db, { id: 't4', session_id: 'sT', ts: 5000, type: 'skill', name: 'brainstorming' });
  ingestEvent(db, { id: 't5', session_id: 'sT', ts: 5000, type: 'user_prompt' });
  const row = db.prepare('SELECT * FROM phase_stats WHERE session_id=? AND phase=?').get('sT', PHASE.BRAINSTORM);
  expect(row.wait_ms).toBe(3000);
  expect(row.inputs).toBe(1);
  db.close();
});
