// The value panel end to end: the repo's flowwatch.json names a feed, the collector reads it without blocking,
// and /api/mission serves its figures — or, when the feed is broken, the reason, never an empty headline.
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

test("the fixture repo's value figures reach /api/mission as the feed wrote them", async () => {
  const res = await get(FIXTURE);
  expect(res.body.panels.value).toEqual({ state: 'data' });
  expect(res.body.value.figures.map((f) => f.text)).toEqual([
    '**2 of 3** checkout flows take real payments',
    '**4 days** since a customer-visible release',
    '**$1,240.00** in self-serve revenue over **31** orders',
  ]);
});

test('a feed command that fails puts its reason on the panel and no figures in the payload', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-value-'));
  fs.writeFileSync(path.join(repo, 'flowwatch.json'), JSON.stringify({ value: { command: ['node', 'value.js'] } }));
  fs.writeFileSync(path.join(repo, 'value.js'), 'console.error("ledger is locked"); process.exit(2)');
  const res = await get(repo);
  expect(res.body.panels.value).toEqual({
    state: 'error',
    reason: 'value: its command exited with code 2: ledger is locked',
  });
  expect(res.body.value).toBeNull();
});

test('two polls during one slow build share it: the feed runs once', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-value-once-'));
  const counter = path.join(repo, 'runs.txt');
  fs.writeFileSync(path.join(repo, 'flowwatch.json'), JSON.stringify({ value: { command: ['node', 'value.js'] } }));
  fs.writeFileSync(
    path.join(repo, 'value.js'),
    `require('fs').appendFileSync(${JSON.stringify(counter)}, 'x');
    setTimeout(() => console.log(JSON.stringify({ format: 1, figures: [{ text: 'ok' }] })), 300);`
  );
  const app = createApp(openDb(':memory:'), { repoRoot: repo, mcTtlMs: 60000 });
  const [a, b] = await Promise.all([request(app).get('/api/mission'), request(app).get('/api/mission')]);
  expect([a.status, b.status]).toEqual([200, 200]);
  expect(fs.readFileSync(counter, 'utf8')).toBe('x');
});
