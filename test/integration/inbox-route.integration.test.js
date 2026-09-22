const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { startServer } = require('../../server/server');

// The repo the collector serves: its MISSION.md lists the categories a title prefix may name.
const SERVED_REPO = path.join(__dirname, '..', 'fixtures', 'repo');

function fixtures() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-route-'));
  const appDir = path.join(root, 'app');
  const txDir = path.join(root, 'projects', 'C--repo');
  const repoRoot = path.join(root, 'repo');
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(txDir, { recursive: true });
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.writeFileSync(
    path.join(appDir, 'local_1.json'),
    JSON.stringify({
      sessionId: 'local_1',
      cliSessionId: 'cli-1',
      cwd: path.join(repoRoot, '.claude', 'worktrees', 'wtA'),
      title: 'Retro: close the guard',
      branch: 'claude/wt-a',
      lastActivityAt: new Date().toISOString(),
      prs: [{ prNumber: 840, state: 'OPEN' }],
    })
  );
  fs.writeFileSync(
    path.join(txDir, 'cli-1.jsonl'),
    JSON.stringify({
      type: 'assistant',
      timestamp: new Date().toISOString(),
      message: { id: 'm-a', role: 'assistant', content: [{ type: 'text', text: 'Done.\n\nShall I merge it?' }] },
    }) + '\n'
  );
  return { appDir, projectsDir: path.join(root, 'projects'), repoRoot };
}

test('the inbox route answers with rows and caches its walk', async () => {
  const { appDir, projectsDir, repoRoot } = fixtures();
  const srv = await startServer({
    port: 0,
    dbPath: ':memory:',
    watchMs: 0,
    repoRoot: SERVED_REPO,
    logDir: path.join(repoRoot, 'logs'),
    inbox: { appDir, projectsDir, repoRoot, ttlMs: 60000 },
  });
  const api = request(`http://127.0.0.1:${srv.port}`);

  const first = (await api.get('/api/inbox')).body;
  expect(first.items).toHaveLength(1);
  expect(first.items[0]).toMatchObject({
    title: 'Retro: close the guard',
    category: 'Retro',
    category_from: 'title prefix',
    state: 'waiting',
    asks: true,
    phase: null,
    phase_from: null,
  });
  expect(first.items[0].last_ask).toBe('Shall I merge it?');
  expect(first.items[0].pr).toEqual({ status: 'open', numbers: [840] });
  expect(first.sources).toEqual({ app_records: 'ok', transcripts: 'ok' });

  // A record written after the first answer must NOT appear while the TTL holds: the page polls,
  // and re-walking every transcript per poll is what the cache exists to prevent.
  fs.writeFileSync(
    path.join(appDir, 'local_2.json'),
    JSON.stringify({
      sessionId: 'local_2',
      cliSessionId: 'cli-2',
      cwd: repoRoot,
      title: 'Later',
      lastActivityAt: new Date().toISOString(),
    })
  );
  const second = (await api.get('/api/inbox')).body;
  expect(second.generated_at).toBe(first.generated_at);
  expect(second.items).toHaveLength(1);

  await srv.close();
});

test('a live event gives the inbox row its phase', async () => {
  const { appDir, projectsDir, repoRoot } = fixtures();
  const srv = await startServer({
    port: 0,
    dbPath: ':memory:',
    watchMs: 0,
    logDir: path.join(repoRoot, 'logs'),
    inbox: { appDir, projectsDir, repoRoot, ttlMs: 0 },
  });
  const api = request(`http://127.0.0.1:${srv.port}`);

  await api.post('/events').send({
    id: 'e1',
    session_id: 'cli-1',
    worktree: 'wtA',
    ts: Date.now(),
    type: 'session_start',
  });

  const body = (await api.get('/api/inbox')).body;
  expect(body.items[0].phase).toBe(1);
  expect(body.items[0].phase_from).toBe('board');

  await srv.close();
});
