// Every panel has an address; the old page addresses and unknown panels land somewhere real.
const request = require('supertest');
const { openDb } = require('../../server/db');
const { createApp } = require('../../server/collector');
const { NAV } = require('../../web/lib/nav.js');

let db, app;
beforeAll(() => {
  db = openDb(':memory:');
  app = createApp(db);
});
afterAll(() => db.close());

// A marker only each page carries, so "200" also proves WHICH page was served.
const MARKER = { 'mission.html': 'id="lc-grid"', 'pipeline.html': 'id="triage"' };

test.each(NAV.flatMap((g) => g.panels.map((p) => [g.base + '/' + p.id, g.file])))('%s serves %s', async (url, file) => {
  const res = await request(app).get(url).expect(200);
  expect(res.text).toContain(MARKER[file]);
});

test.each([
  ['/', '/pipeline/sessions'],
  ['/pipeline', '/pipeline/sessions'],
  ['/mission', '/mission/milestones'],
  ['/pipeline/nope', '/pipeline/sessions'],
  ['/pipeline/needs-me', '/pipeline/sessions'], // merged into Sessions
  ['/pipeline/phases', '/pipeline/sessions'],
  ['/mission/sessions', '/mission/milestones'],
  ['/mission/lifecycle', '/mission/stages'], // the panel's old name
])('%s redirects to %s', async (url, to) => {
  const res = await request(app).get(url).expect(302);
  expect(res.headers.location).toBe(to);
});

test('an address outside both groups is not a page', async () => {
  await request(app).get('/pipeline-x').expect(404);
});
