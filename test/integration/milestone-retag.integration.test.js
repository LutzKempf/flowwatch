// days=0 opts out of the session age window: these fixtures seed synthetic
// timestamps (ts:1000 and friends), and this suite is asserting ingest/replay,
// not which sessions the board chooses to show.
const path = require('path');
const request = require('supertest');
const { openDb } = require('../../server/db');
const { ingestEvent } = require('../../server/ingest');
const { createApp } = require('../../server/collector');

// A made-up repo whose MISSION.md names the milestones a session can be tagged with.
const REPO = path.join(__dirname, '..', 'fixtures', 'repo');

test('PATCH /api/sessions/:id/milestone re-tags a session; bad body 400; unknown session 404', async () => {
  const db = openDb(':memory:');
  ingestEvent(db, { id: 'm1', session_id: 'sM', worktree: 'w', ts: 1, type: 'session_start' });
  const app = createApp(db, { repoRoot: REPO });
  // 'guest-checkout-live' is a real id in the fixture repo's MISSION.md
  await request(app).patch('/api/sessions/sM/milestone').send({ milestone: 'guest-checkout-live' }).expect(200);
  const res = await request(app).get('/api/pipeline?days=0');
  expect(res.body.sessions.find((s) => s.id === 'sM').milestone).toBe('guest-checkout-live');
  await request(app).patch('/api/sessions/sM/milestone').send({}).expect(400);
  await request(app).patch('/api/sessions/ghost/milestone').send({ milestone: 'unassigned' }).expect(404);
});

test('PATCH milestone rejects ids not in MISSION.md (typos surface as 400, not silent bad tags)', async () => {
  const db = openDb(':memory:');
  ingestEvent(db, { id: 'm2', session_id: 'sV', worktree: 'w', ts: 1, type: 'session_start' });
  const app = createApp(db, { repoRoot: REPO });
  const res = await request(app).patch('/api/sessions/sV/milestone').send({ milestone: 'guest-chekout-live' }); // typo'd id
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/unknown milestone/);
  // literal 'unassigned' is always allowed (the un-tag state)
  await request(app).patch('/api/sessions/sV/milestone').send({ milestone: 'unassigned' }).expect(200);
});
