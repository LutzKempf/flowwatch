const request = require('supertest');
const { openDb } = require('../../server/db');
const { createApp } = require('../../server/collector');

test('GET /api/mission returns a payload from injected repo paths', async () => {
  const app = createApp(openDb(':memory:'), {
    specsDir: __dirname + '/../fixtures/specs',
    changesDir: __dirname + '/../fixtures/changes',
    repoDir: process.cwd(),
  });
  const res = await request(app).get('/api/mission').expect(200);
  expect(res.body.totals.total).toBeGreaterThan(0);
  expect(Array.isArray(res.body.milestones)).toBe(true);
});
