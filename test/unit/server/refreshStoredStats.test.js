// Each session's per-phase figures are STORED, and redone only when that session gets a new event. So when the
// roll-up's rule changes, a finished session would keep showing the old rule's numbers for good — which is exactly
// what a board upgraded from 1.0.2 did: the fix was installed and every old row stayed wrong.
const { openDb } = require('../../../server/db');
const { ingestEvent, refreshStoredStats } = require('../../../server/ingest');
const { ROLLUP_VERSION } = require('../../../server/metricsRollup');

const stored = (db, id, phase) =>
  db.prepare('SELECT work_ms, inputs FROM phase_stats WHERE session_id=? AND phase=?').get(id, phase);

function boardWithAStaleRow() {
  const db = openDb(':memory:');
  ingestEvent(db, { id: 'e1', session_id: 's1', worktree: 'w', ts: 0, type: 'user_prompt' });
  ingestEvent(db, { id: 'e2', session_id: 's1', worktree: 'w', ts: 60_000, type: 'turn_stop' });
  // What an older rule left behind: figures the events do not support, and no record of the rule's version.
  db.prepare('UPDATE phase_stats SET work_ms=999, inputs=7 WHERE session_id=? AND phase=1').run('s1');
  db.prepare("DELETE FROM meta WHERE key='rollup_version'").run();
  return db;
}

test('figures stored under an older rule are redone from the events', () => {
  const db = boardWithAStaleRow();
  expect(refreshStoredStats(db)).toBe(1);
  expect(stored(db, 's1', 1)).toEqual({ work_ms: 60_000, inputs: 1 });
  expect(db.prepare("SELECT value FROM meta WHERE key='rollup_version'").get().value).toBe(String(ROLLUP_VERSION));
  db.close();
});

test('once current, a restart redoes nothing', () => {
  const db = boardWithAStaleRow();
  refreshStoredStats(db);
  db.prepare('UPDATE phase_stats SET work_ms=5 WHERE session_id=? AND phase=1').run('s1');
  expect(refreshStoredStats(db)).toBe(0);
  expect(stored(db, 's1', 1).work_ms).toBe(5); // untouched: the stored rule is the current one
  db.close();
});
