// days=0 opts out of the session age window: these fixtures seed synthetic
// timestamps (ts:1000 and friends), and this suite is asserting ingest/replay,
// not which sessions the board chooses to show.
const request = require('supertest');
const { openDb } = require('../../server/db');
const { createApp } = require('../../server/collector');

test('POST /events then GET /api/pipeline reflects the session', async () => {
  const app = createApp(openDb(':memory:'));
  await request(app)
    .post('/events')
    .send({ id: 'e1', session_id: 's1', worktree: 'w', ts: 1000, type: 'bash', command: 'gh pr create' })
    .expect(200);
  const res = await request(app).get('/api/pipeline?days=0').expect(200);
  const s1 = res.body.sessions.find((s) => s.id === 's1');
  expect(s1.current_phase).toBe(7); // PR
});

test('POST /events with a bad body returns 400', async () => {
  const app = createApp(openDb(':memory:'));
  await request(app).post('/events').send({ type: 'x' }).expect(400);
});

test('GET /health returns ok', async () => {
  const app = createApp(openDb(':memory:'));
  await request(app)
    .get('/health')
    .expect(200)
    .expect((r) => expect(r.body.ok).toBe(true));
});

test('a bash event carrying a 20kb command is accepted, not 413-rejected', async () => {
  const app = createApp(openDb(':memory:'));
  const bigCommand = 'echo ' + 'x'.repeat(20 * 1024);
  await request(app)
    .post('/events')
    .send({ id: 'big1', session_id: 'sBig', worktree: 'w', ts: 1000, type: 'bash', command: bigCommand })
    .expect(200);
  const res = await request(app).get('/api/pipeline?days=0').expect(200);
  expect(res.body.sessions.find((s) => s.id === 'sBig')).toBeTruthy();
});

test('GET /api/mission carries no narrative field: the panel is gone, nothing ever wrote its file', async () => {
  const app = createApp(openDb(':memory:'), {
    specsDir: __dirname + '/../fixtures/specs',
    changesDir: __dirname + '/../fixtures/changes',
    repoDir: process.cwd(),
  });
  const res = await request(app).get('/api/mission').expect(200);
  expect(res.body).not.toHaveProperty('narrative');
});
