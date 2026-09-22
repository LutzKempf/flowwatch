const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { startServer } = require('../../server/server');
const { canonicalRepoRoot } = require('../../server/repo/repoRoot');

test('backfilled history + a live event both surface in the dashboards data', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'accept-'));
  // The collector imports only its own repo's sessions (projectDirFilter): the fixture folder is named the
  // way Claude Code names a worktree of the repo this server serves — a made-up repo with a MISSION.md.
  const repoRoot = path.join(__dirname, '..', 'fixtures', 'repo');
  const slug = path.resolve(canonicalRepoRoot(repoRoot)).replace(/[^A-Za-z0-9]/g, '-');
  const wt = path.join(root, slug + '--claude-worktrees-wtA');
  fs.mkdirSync(wt, { recursive: true });
  // The fixture's timestamps are fixed (2026-07-03) and /api/pipeline windows sessions to the last
  // 14 days, so a verbatim copy ages out of the board and this test starts failing by the calendar
  // rather than by a defect. Shift every stamp so the transcript ends an hour ago.
  const fixture = fs
    .readFileSync(path.join(__dirname, '../fixtures/transcript.jsonl'), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const newest = Math.max(...fixture.map((r) => Date.parse(r.timestamp)).filter(Number.isFinite));
  const shift = Date.now() - 3600000 - newest;
  const shifted =
    fixture
      .map((r) => {
        if (r.timestamp) r.timestamp = new Date(Date.parse(r.timestamp) + shift).toISOString();
        return JSON.stringify(r);
      })
      .join('\n') + '\n';
  fs.writeFileSync(path.join(wt, 'histSess.jsonl'), shifted);

  const srv = await startServer({
    port: 0,
    dbPath: ':memory:',
    backfillRoot: root,
    watchMs: 0,
    repoRoot,
    logDir: path.join(root, 'logs'),
    // hermetic sources for the Mission page
    specsDir: path.join(__dirname, '../fixtures/specs'),
    changesDir: path.join(__dirname, '../fixtures/changes'),
    repoDir: process.cwd(),
  });
  const api = request(`http://127.0.0.1:${srv.port}`);
  await api
    .post('/events')
    .send({ id: 'live1', session_id: 'liveSess', worktree: 'wtB', ts: Date.now(), type: 'session_start' });

  const pipe = (await api.get('/api/pipeline')).body;
  expect(pipe.sessions.map((s) => s.id)).toEqual(expect.arrayContaining(['histSess', 'liveSess']));
  // The backfilled session is flagged (the board badges it ◔ partial) and carries
  // non-zero transcript-derived token totals — never a silent $0/0 baseline.
  const hist = pipe.sessions.find((s) => s.id === 'histSess');
  expect(hist.origin).toBe('backfill');
  expect(hist.phases.reduce((n, p) => n + p.tokens, 0)).toBeGreaterThan(0);
  expect(pipe.sessions.find((s) => s.id === 'liveSess').origin).toBe('live');

  const mc = (await api.get('/api/mission')).body;
  expect(mc.milestones.length).toBeGreaterThan(0);
  await srv.close();
});
