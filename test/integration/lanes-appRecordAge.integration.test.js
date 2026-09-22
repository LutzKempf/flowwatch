const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { startServer } = require('../../server/server');

// The repo the collector serves: its MISSION.md lists the categories the lane cards are sorted into.
const SERVED_REPO = path.join(__dirname, '..', 'fixtures', 'repo');

let root;
let srv;
const saved = process.env.FLOWWATCH_MAX_AGE_DAYS;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-record-age-'));
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

// A record's lastActivityAt is the app's clock, not the board's, so the lanes route must not filter app
// records by the board's window: a session active on the board an hour ago whose record was last touched
// days ago would lose its record and vanish from every card as "no app record".
test('a board session keeps its card when its app record was last touched before the window', async () => {
  process.env.FLOWWATCH_MAX_AGE_DAYS = '3';
  const repoRoot = path.join(root, 'repo');
  const appDir = path.join(root, 'app');
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.mkdirSync(appDir, { recursive: true });
  const now = Date.now();
  fs.writeFileSync(
    path.join(appDir, 'local_live.json'),
    JSON.stringify({
      sessionId: 'local_live',
      cliSessionId: 'cli-live',
      cwd: path.join(repoRoot, '.claude', 'worktrees', 'wt-live'),
      title: 'Retro: still going',
      branch: 'claude/live',
      lastActivityAt: now - 5 * 24 * 60 * 60 * 1000,
    })
  );
  srv = await startServer({
    port: 0,
    dbPath: ':memory:',
    watchMs: 0,
    logDir: path.join(root, 'logs'),
    repoRoot: SERVED_REPO,
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
    .send({
      id: 'e-live',
      session_id: 'cli-live',
      worktree: 'wt-live',
      ts: now - 60 * 60 * 1000,
      type: 'session_start',
    })
    .expect(200);

  const lanes = (await api.get('/api/lanes')).body;
  expect(lanes.without_app_record).toBe(0);
  const retro = lanes.lanes.find((l) => l.name === 'Retro');
  expect(retro.sessions.map((s) => [s.id, s.title])).toEqual([['cli-live', 'Retro: still going']]);
});
