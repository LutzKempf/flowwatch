const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../../server/db');
const { ingestEvent } = require('../../server/ingest');
const { scanOnce } = require('../../server/repo/repoWatcher');

// flowwatch.json "pipeline": the folders are the repo's to name; these are made up on purpose.
const PIPELINE = { passMarkers: 'checks/passed', goalMarkers: 'checks/changes', evidence: 'checks/evidence' };

test('a real-shaped gate marker (sha+worktree, NO session_id) attributes to the latest session in that worktree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-'));
  fs.mkdirSync(path.join(root, 'checks/passed'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'checks/passed', 'abc123.json'),
    JSON.stringify({ sha: 'abc123', finishedAt: '2026-07-03T09:00:00Z', worktree: 'w1' })
  ); // real shape

  const db = openDb(':memory:');
  // two sessions in w1 — the marker must land on the LATEST one
  ingestEvent(db, { id: 'x1', session_id: 'sOld', worktree: 'w1', ts: 1000, type: 'session_start' });
  ingestEvent(db, { id: 'x2', session_id: 'sNew', worktree: 'w1', ts: 2000, type: 'session_start' });

  expect(scanOnce(db, { root, pipeline: PIPELINE })).toBe(1);
  expect(scanOnce(db, { root, pipeline: PIPELINE })).toBe(0); // idempotent
  const ev = db.prepare("SELECT * FROM events WHERE type='gate_pass'").get();
  expect(ev.session_id).toBe('sNew');
  db.close();
});

test('a marker for a worktree with NO known session is skipped, not invented', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch2-'));
  fs.mkdirSync(path.join(root, 'checks/passed'), { recursive: true });
  fs.writeFileSync(path.join(root, 'checks/passed', 'zzz.json'), JSON.stringify({ sha: 'zzz', worktree: 'ghost' }));
  const db = openDb(':memory:');
  expect(scanOnce(db, { root, pipeline: PIPELINE })).toBe(0);
  expect(db.prepare('SELECT COUNT(*) c FROM sessions').get().c).toBe(0); // no phantom session
  db.close();
});

test('a per-change marker (<folder>/<change>/<sha>.json) attributes like a pass marker and maps to goal_pass', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch3-'));
  const sha = 'a'.repeat(40);
  const topicDir = path.join(root, 'checks/changes', '2026-07-17-guest-checkout');
  fs.mkdirSync(topicDir, { recursive: true });
  fs.writeFileSync(
    path.join(topicDir, `${sha}.json`),
    JSON.stringify({ sha, finishedAt: 1720000000000, worktree: 'w1' })
  );
  // store housekeeping files must NOT ingest: lock + last-run are not sha-shaped
  fs.writeFileSync(path.join(topicDir, '.running.json'), JSON.stringify({ pid: 1, startedAt: 1 }));
  fs.writeFileSync(path.join(topicDir, 'last-run.json'), JSON.stringify({ sha, pass: true }));

  const db = openDb(':memory:');
  ingestEvent(db, { id: 'x1', session_id: 's1', worktree: 'w1', ts: 1000, type: 'session_start' });

  expect(scanOnce(db, { root, pipeline: PIPELINE })).toBe(1);
  expect(scanOnce(db, { root, pipeline: PIPELINE })).toBe(0); // idempotent
  const ev = db.prepare("SELECT * FROM events WHERE type='goal_pass'").get();
  expect(ev.session_id).toBe('s1');
  expect(JSON.parse(ev.payload).topic).toBe('2026-07-17-guest-checkout');
  db.close();
});

test('a goal marker for an unknown worktree is skipped, not invented', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch4-'));
  const topicDir = path.join(root, 'checks/changes', 'some-topic');
  fs.mkdirSync(topicDir, { recursive: true });
  fs.writeFileSync(
    path.join(topicDir, `${'b'.repeat(40)}.json`),
    JSON.stringify({ sha: 'b'.repeat(40), worktree: 'ghost' })
  );
  const db = openDb(':memory:');
  expect(scanOnce(db, { root, pipeline: PIPELINE })).toBe(0);
  expect(db.prepare('SELECT COUNT(*) c FROM sessions').get().c).toBe(0);
  db.close();
});

test('a folder the settings do not name is never read', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch5-'));
  fs.mkdirSync(path.join(root, 'checks', 'passed'), { recursive: true });
  fs.writeFileSync(path.join(root, 'checks', 'passed', 'c1.json'), JSON.stringify({ session_id: 's1' }));
  const db = openDb(':memory:');
  expect(scanOnce(db, { root })).toBe(0);
  expect(scanOnce(db, { root, pipeline: { goalMarkers: 'checks/changes' } })).toBe(0);
  expect(scanOnce(db, { root, pipeline: { passMarkers: 'checks/passed' } })).toBe(1);
  db.close();
});

test('an evidence file naming its worktree (wt-<name>) maps to verify; one naming none is skipped', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch6-'));
  const dir = path.join(root, 'checks', 'evidence');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-09-01-wt-w1.md'), '# ran it');
  fs.writeFileSync(path.join(dir, '2026-09-01-nobody.md'), '# ran it');
  const db = openDb(':memory:');
  ingestEvent(db, { id: 'x1', session_id: 's1', worktree: 'w1', ts: 1000, type: 'session_start' });
  expect(scanOnce(db, { root, pipeline: PIPELINE })).toBe(1);
  expect(db.prepare("SELECT session_id FROM events WHERE type='verify'").get().session_id).toBe('s1');
  db.close();
});
