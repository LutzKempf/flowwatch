// Session state over real HTTP, end to end.
//
// Why this exists: `sessions.state` is declared TEXT DEFAULT 'working', so a code path
// that stops writing it leaves the dashboard's "waiting on you" branch unreachable, reading
// 0 for good. A unit test on stateForEvents() proves the pure function; only this tier
// proves the value survives ingest, the DB, and the API.
const request = require('supertest');
const { openDb } = require('../../server/db');
const { createApp } = require('../../server/collector');

const DAY = 24 * 60 * 60 * 1000;

async function post(app, ev) {
  return request(app).post('/events').send(ev).expect(200);
}

test('a turn_stop event makes the session waiting on the operator', async () => {
  const app = createApp(openDb(':memory:'));
  const now = Date.now();
  await post(app, { id: 'e1', session_id: 's-wait', worktree: 'w', ts: now, type: 'bash', command: 'ls' });
  await post(app, { id: 'e2', session_id: 's-wait', worktree: 'w', ts: now, type: 'turn_stop' });

  const res = await request(app).get('/api/pipeline').expect(200);
  const s = res.body.sessions.find((x) => x.id === 's-wait');
  expect(s.state).toBe('waiting');
  expect(s.archived).toBe(false);
});

test('a further event after the turn_stop puts the session back to working', async () => {
  const app = createApp(openDb(':memory:'));
  const now = Date.now();
  await post(app, { id: 'f1', session_id: 's-back', worktree: 'w', ts: now, type: 'turn_stop' });
  await post(app, { id: 'f2', session_id: 's-back', worktree: 'w', ts: now + 1, type: 'user_prompt' });

  const res = await request(app).get('/api/pipeline').expect(200);
  expect(res.body.sessions.find((x) => x.id === 's-back').state).toBe('working');
});

test('an old session is archived and carries its stats into history', async () => {
  const app = createApp(openDb(':memory:'));
  // 8 days: older than archiveMs (7d) and inside the server's 14-day window, which is
  // the band where a session is archived rather than dropped from the payload entirely.
  const old = Date.now() - 8 * DAY;
  await post(app, { id: 'g1', session_id: 's-old', worktree: 'w-old', ts: old, type: 'session_start' });

  const res = await request(app).get('/api/pipeline').expect(200);
  const s = res.body.sessions.find((x) => x.id === 's-old');
  expect(s.archived).toBe(true);
  // the lane board hides it, but the rollup must still count it
  expect(res.body.history.sessions).toBe(1);
  expect(res.body.history.worktrees).toBe(1);
});

test('GET /api/pipeline always carries a history object, even with no sessions', async () => {
  // The client renders history unconditionally; a missing key would throw in the
  // browser rather than render an empty panel.
  const app = createApp(openDb(':memory:'));
  const res = await request(app).get('/api/pipeline').expect(200);
  expect(res.body.history).toEqual({ sessions: 0, worktrees: 0, workMs: 0, waitMs: 0, inputs: 0 });
});
