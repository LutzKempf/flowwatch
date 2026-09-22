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
