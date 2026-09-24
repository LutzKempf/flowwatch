// The board paints every phase before a session's current one as passed. Most sessions pass Brainstorm, OpenSpec
// and Plan without ever being in them, and those phases then read "0m" -- as if the work there took no time, when
// nothing happened there at all. So each phase's stored figures say whether the session was in it.
const Database = require('better-sqlite3');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../../../server/db');
const { ingestEvent } = require('../../../server/ingest');
const { buildPipeline } = require('../../../server/pipelineApi');

test('the pipeline says which phases a session was in, and which it passed without entering', () => {
  const db = openDb(':memory:');
  const at = (id, ts, type, extra = {}) => ingestEvent(db, { id, session_id: 's1', worktree: 'w', ts, type, ...extra });
  at('e1', 0, 'user_prompt');
  at('e2', 1000, 'commit'); // GOAL -> EXECUTE
  at('e3', 2000, 'turn_stop');
  const s = buildPipeline(db, { now: 3000 }).sessions.find((x) => x.id === 's1');
  expect(s.phases.slice(0, 5).map((p) => p.entered)).toEqual([true, false, false, false, true]);
  db.close();
});

test('a database made before the column existed gains it', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fw-entered-')), 'old.db');
  const old = new Database(file);
  old.exec(`CREATE TABLE phase_stats (session_id TEXT, phase INTEGER, work_ms INTEGER DEFAULT 0,
    wait_ms INTEGER DEFAULT 0, inputs INTEGER DEFAULT 0, tokens_usd REAL DEFAULT 0, tokens INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, phase))`);
  old.close();

  const db = openDb(file);
  const cols = db
    .prepare('PRAGMA table_info(phase_stats)')
    .all()
    .map((c) => c.name);
  expect(cols).toContain('entered');
  db.close();
  openDb(file).close(); // a second open adds nothing twice
});
