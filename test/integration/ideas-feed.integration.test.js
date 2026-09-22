// The Ideas panel end to end: the repo's flowwatch.json names a feed, the collector reads it, and
// /api/mission serves its sections with the counts Flowwatch made — or, when the feed is broken, the
// reason, never an empty list that reads as "nothing tried".
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { openDb } = require('../../server/db');
const { createApp } = require('../../server/collector');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'repo');
const get = (repoRoot) =>
  request(createApp(openDb(':memory:'), { repoRoot, mcTtlMs: 0 }))
    .get('/api/mission')
    .expect(200);

test("the fixture repo's ideas reach /api/mission, counted and dated by Flowwatch", async () => {
  const res = await get(FIXTURE);
  expect(res.body.panels.ideas).toEqual({ state: 'data' });
  expect(res.body.ideas.source).toBe('docs/checkout-ideas.md');
  expect(res.body.ideas.sections.map((s) => [s.title, s.ideas.length, s.counts, s.latest])).toEqual([
    ['Checkout flow', 3, { closed: 1, inconclusive: 1, open: 1, unclassified: 0 }, '2026-09-02'],
    ['Payments', 2, { closed: 0, inconclusive: 0, open: 1, unclassified: 1 }, '2026-09-10'],
  ]);
});

test('a feed with an unknown bucket puts the problem on the panel, and no ideas in the payload', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-ideas-'));
  fs.writeFileSync(path.join(repo, 'flowwatch.json'), JSON.stringify({ ideas: { command: ['node', 'ideas.js'] } }));
  fs.writeFileSync(
    path.join(repo, 'ideas.js'),
    'console.log(JSON.stringify({ format: 1, sections: [{ title: "Checkout", ' +
      'ideas: [{ name: "Guest checkout", verdict: "Maybe", bucket: "maybe" }] }] }))'
  );
  const res = await get(repo);
  expect(res.body.panels.ideas).toEqual({
    state: 'error',
    reason:
      'ideas does not match its format: sections[0].ideas[0].bucket must be one of closed, inconclusive, open, unclassified',
  });
  expect(res.body.ideas).toBeNull();
});
