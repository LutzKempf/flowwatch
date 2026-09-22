const request = require('supertest');
const { openDb } = require('../../server/db');
const { createApp } = require('../../server/collector');

test('serves the two dashboards at their panel addresses', async () => {
  const app = createApp(openDb(':memory:'));
  await request(app)
    .get('/mission/milestones')
    .expect(200)
    .expect(/Mission/i);
  await request(app)
    .get('/pipeline/sessions')
    .expect(200)
    .expect(/pipeline/i);
});

// The pages load their modules by absolute address, since a page is served at panel addresses; a browser runs a
// module only when it is served as JavaScript.
test("serves each page's modules as JavaScript, and its stylesheet", async () => {
  const app = createApp(openDb(':memory:'));
  for (const page of ['pipeline', 'mission']) {
    await request(app)
      .get('/pages/' + page + '/main.js')
      .expect(200)
      .expect('Content-Type', /^(text|application)\/javascript\b/);
    await request(app)
      .get('/pages/' + page + '/page.css')
      .expect(200)
      .expect('Content-Type', /^text\/css\b/);
  }
});
