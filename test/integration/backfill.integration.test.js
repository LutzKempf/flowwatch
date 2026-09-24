const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../../server/db');
const { backfillDir } = require('../../server/sessions/runBackfill');

test('backfills a projects dir of transcripts into sessions (idempotent)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-'));
  const wtDir = path.join(root, 'C--repo--worktrees-wtA');
  fs.mkdirSync(wtDir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, '../fixtures/transcript.jsonl'), path.join(wtDir, 'sess-1.jsonl'));

  const db = openDb(':memory:');
  const n1 = backfillDir(db, root);
  const n2 = backfillDir(db, root); // idempotent
  expect(n1).toBeGreaterThan(0);
  expect(n2).toBe(0);
  const s = db.prepare('SELECT * FROM sessions').get();
  expect(s.current_phase).toBe(7); // gh pr create in the fixture
  expect(s.origin).toBe('backfill'); // flagged: its data is partial
  db.close();
});

test('skips subagents/ dirs — subagent transcripts must not become phantom sessions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-sa-'));
  const wtDir = path.join(root, 'C--repo--worktrees-wtB');
  fs.mkdirSync(path.join(wtDir, 'subagents'), { recursive: true });
  const fixture = path.join(__dirname, '../fixtures/transcript.jsonl');
  fs.copyFileSync(fixture, path.join(wtDir, 'sess-1.jsonl'));
  fs.copyFileSync(fixture, path.join(wtDir, 'subagents', 'agent-x.jsonl'));

  const db = openDb(':memory:');
  backfillDir(db, root);
  const ids = db
    .prepare('SELECT id FROM sessions ORDER BY id')
    .all()
    .map((r) => r.id);
  expect(ids).toEqual(['sess-1']); // agent-x never ingested
  db.close();
});

// A session that reported live while it ran is not partial. Re-walking the transcripts (which is how the token
// figures arrive for finished sessions) must not badge it as partial, or the board would call its best data partial.
test('a session that also reported live keeps its origin when its transcript is walked', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-live-'));
  const wtDir = path.join(root, 'C--repo--worktrees-wtC');
  fs.mkdirSync(wtDir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, '../fixtures/transcript.jsonl'), path.join(wtDir, 'sess-live.jsonl'));

  const db = openDb(':memory:');
  const { ingestEvent } = require('../../server/ingest');
  ingestEvent(db, { id: 'hook-1', session_id: 'sess-live', worktree: 'wtC', ts: 1000, type: 'session_start' });
  expect(db.prepare('SELECT origin FROM sessions WHERE id=?').get('sess-live').origin).toBe('live');

  expect(backfillDir(db, root)).toBeGreaterThan(0);
  expect(db.prepare('SELECT origin FROM sessions WHERE id=?').get('sess-live').origin).toBe('live');
  // and the transcript's own events did land on it
  expect(
    db.prepare("SELECT COUNT(*) c FROM events WHERE session_id=? AND id LIKE 'bf:%'").get('sess-live').c
  ).toBeGreaterThan(0);
  db.close();
});
