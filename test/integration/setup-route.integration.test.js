// GET /api/setup is the list the setup banner shows on both pages, and the one `npx flowwatch check`
// prints; it also says when a live session last reported, so the Sessions board can
// tell "installed, no session yet" from "tracking".
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { openDb } = require('../../server/db');
const { createApp } = require('../../server/collector');

test('an empty repo: not set up, the banner items in order, and no session has reported yet', async () => {
  const app = createApp(openDb(':memory:'), { repoRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'setup-route-')) });
  const res = await request(app).get('/api/setup').expect(200);
  expect(res.body.ok).toBe(false);
  expect(res.body.banner.map((b) => b.id)).toEqual(['mission', 'hooks', 'stages', 'ideas', 'value', 'gates', 'specs']);
  expect(res.body.lastEventAt).toBeNull();

  await request(app)
    .post('/events')
    .send({ id: 'e1', session_id: 's1', worktree: 'wt', ts: Date.now(), type: 'session_start' })
    .expect(200);
  expect((await request(app).get('/api/setup').expect(200)).body.lastEventAt).toEqual(expect.any(Number));
});
