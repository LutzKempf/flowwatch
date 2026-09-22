const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { startServer } = require('../../server/server');

let root;
let srv;
const saved = process.env.FLOWWATCH_MAX_AGE_DAYS;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-window-'));
});
afterEach(async () => {
  if (srv) {
    await srv.close();
    srv = null;
  }
  if (saved === undefined) delete process.env.FLOWWATCH_MAX_AGE_DAYS;
  else process.env.FLOWWATCH_MAX_AGE_DAYS = saved;
  fs.rmSync(root, { recursive: true, force: true });
});

// /api/lanes uses the same window as /api/pipeline (FLOWWATCH_MAX_AGE_DAYS): with a window of its own, a
// card could list a session the phases detail has no record of.
test('the lane cards use the board window the operator configured', async () => {
  process.env.FLOWWATCH_MAX_AGE_DAYS = '3';
  const repoRoot = path.join(root, 'repo');
  const appDir = path.join(root, 'app');
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.mkdirSync(appDir, { recursive: true });
  const now = Date.now();
  const fiveDaysAgo = now - 5 * 24 * 60 * 60 * 1000;
  fs.writeFileSync(
    path.join(appDir, 'local_old.json'),
    JSON.stringify({
      sessionId: 'local_old',
      cliSessionId: 'cli-old',
      cwd: path.join(repoRoot, '.claude', 'worktrees', 'wt-old'),
      title: 'Retro: an older session',
      branch: 'claude/old',
      lastActivityAt: fiveDaysAgo,
    })
  );
  srv = await startServer({
    port: 0,
    dbPath: ':memory:',
    watchMs: 0,
    logDir: path.join(root, 'logs'),
    inbox: {
      appDir,
      projectsDir: path.join(root, 'projects'),
      repoRoot,
      inferCategory: () => null,
      ttlMs: 0,
      skillsDir: path.join(root, 'no-skills'),
    },
  });
  const api = request(`http://127.0.0.1:${srv.port}`);
  await api
    .post('/events')
    .send({ id: 'e-old', session_id: 'cli-old', worktree: 'wt-old', ts: fiveDaysAgo, type: 'session_start' })
    .expect(200);

  const board = (await api.get('/api/pipeline')).body;
  expect(board.sessions.map((s) => s.id)).not.toContain('cli-old');
  const lanes = (await api.get('/api/lanes')).body;
  const carded = lanes.lanes.flatMap((l) => l.sessions.map((s) => s.id));
  expect(carded).not.toContain('cli-old');
  expect(lanes.window_days).toBe(3);
});
