const request = require('supertest');
const { openDb } = require('../../../server/db');
const { createApp } = require('../../../server/collector');

// The collector served nothing at its bare address, so http://localhost:4477 answered
// "Cannot GET /" — a page that reads as a broken server to anyone who types the host.
test('the bare address sends you to the Sessions panel', async () => {
  const db = openDb(':memory:');
  try {
    const res = await request(createApp(db)).get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/pipeline/sessions');
  } finally {
    db.close();
  }
});
