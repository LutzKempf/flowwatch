// days=0 opts out of the session age window: these fixtures seed synthetic
// timestamps (ts:1000 and friends), and this suite is asserting ingest/replay,
// not which sessions the board chooses to show.
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const Database = require('better-sqlite3');
const { startServer } = require('../../server/server');
const { canonicalRepoRoot } = require('../../server/repo/repoRoot');

// The backfill imports only the repo's own transcript folders (its checkout and .claude/worktrees/), which
// Claude Code names after the path: each test gets a repo and a projects folder named for it.
const repoAndProject = (name) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bfb-repo-'));
  const slug = path.resolve(canonicalRepoRoot(repoRoot)).replace(/[^A-Za-z0-9]/g, '-');
  return { repoRoot, project: slug + '--claude-worktrees-' + name };
};

test('server backfills the projects dir once at boot', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bfb-'));
  const { repoRoot, project } = repoAndProject('wtB');
  const wt = path.join(root, project);
  fs.mkdirSync(wt, { recursive: true });
  fs.copyFileSync(path.join(__dirname, '../fixtures/transcript.jsonl'), path.join(wt, 'sboot.jsonl'));

  const srv = await startServer({
    port: 0,
    dbPath: ':memory:',
    backfillRoot: root,
    watchMs: 0,
    repoRoot,
    logDir: path.join(root, 'logs'),
  });
  const res = await request(`http://127.0.0.1:${srv.port}`).get('/api/pipeline?days=0');
  expect(res.body.sessions.find((s) => s.id === 'sboot')).toBeTruthy();
  await srv.close();
});

test('backfill is ONCE-ONLY: a second boot against the same db does not re-walk (the backfill_done marker)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bfb2-'));
  const { repoRoot, project } = repoAndProject('wtC');
  const wt = path.join(root, project);
  fs.mkdirSync(wt, { recursive: true });
  fs.copyFileSync(path.join(__dirname, '../fixtures/transcript.jsonl'), path.join(wt, 'stwice.jsonl'));
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bfdb-')), 'pipeline.db');

  const srv1 = await startServer({
    port: 0,
    dbPath,
    backfillRoot: root,
    watchMs: 0,
    repoRoot,
    logDir: path.join(root, 'logs'),
  });
  await srv1.close();

  // drop a NEW transcript after boot 1 — a second boot must NOT pick it up (marker set)
  fs.copyFileSync(path.join(__dirname, '../fixtures/transcript.jsonl'), path.join(wt, 'late.jsonl'));

  const srv2 = await startServer({
    port: 0,
    dbPath,
    backfillRoot: root,
    watchMs: 0,
    repoRoot,
    logDir: path.join(root, 'logs'),
  });
  const res = await request(`http://127.0.0.1:${srv2.port}`).get('/api/pipeline?days=0');
  expect(res.body.sessions.find((s) => s.id === 'stwice')).toBeTruthy();
  expect(res.body.sessions.find((s) => s.id === 'late')).toBeUndefined(); // not re-walked
  await srv2.close();

  const db = new Database(dbPath, { readonly: true });
  const marker = db.prepare("SELECT value FROM meta WHERE key='backfill_done'").get();
  expect(marker).toBeTruthy();
  const evCount = db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
  expect(String(evCount)).toBe(marker.value); // marker records boot-1's count; unchanged by boot 2
  db.close();
});
