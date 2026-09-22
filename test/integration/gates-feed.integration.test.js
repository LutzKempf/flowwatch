// The Gates panel end to end: the repo's flowwatch.json names a feed, and /api/gates serves what it printed,
// with the panel's state — or, when there is no feed or it is broken, that state and its reason, never an
// empty queue that looks like a quiet box. Cached briefly, and built once however many tabs poll.
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { openDb } = require('../../server/db');
const { createApp } = require('../../server/collector');
const { startServer } = require('../../server/server');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'repo');
const appFor = (repoRoot, opts = {}) => createApp(openDb(':memory:'), { repoRoot, ...opts });
const repoWith = (wiring, files = {}) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-gates-'));
  fs.writeFileSync(path.join(repo, 'flowwatch.json'), JSON.stringify(wiring));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(repo, name), text);
  return repo;
};

test("the fixture repo's gates reach /api/gates as the feed wrote them, with the panel's state", async () => {
  const res = await request(appFor(FIXTURE)).get('/api/gates').expect(200);
  const feed = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'feeds', 'gates.json'), 'utf8'));
  expect(res.body).toEqual({ ...feed, state: 'data' });
  expect(res.body.running.map((r) => r.branch)).toEqual(['feat/guest-address-form']);
  expect(res.body.waiting.map((w) => [w.position, w.branch])).toEqual([
    [1, 'fix/cart-totals'],
    [2, 'feat/order-emails'],
  ]);
});

test('a repo with no gates feed is not set up, and the route says so rather than showing an empty queue', async () => {
  const res = await request(appFor(fs.mkdtempSync(path.join(os.tmpdir(), 'fw-gates-none-'))))
    .get('/api/gates')
    .expect(200);
  expect(res.body).toEqual({ state: 'not-set-up' });
  expect(
    await request(appFor(repoWith({ gates: false })))
      .get('/api/gates')
      .then((r) => r.body)
  ).toEqual({ state: 'off' });
});

test('a feed command that fails puts its reason on the panel, and no queue in the payload', async () => {
  const repo = repoWith(
    { gates: { command: ['node', 'gates.js'] } },
    { 'gates.js': 'console.error("scheduler folder is locked"); process.exit(4)' }
  );
  const res = await request(appFor(repo)).get('/api/gates').expect(200);
  expect(res.body).toEqual({
    state: 'error',
    reason: 'gates: its command exited with code 4: scheduler folder is locked',
  });
});

test('a queue that does not match the format names the problem', async () => {
  const repo = repoWith(
    { gates: { file: 'gates.json' } },
    { 'gates.json': JSON.stringify({ format: 1, running: [], waiting: [{ worktree: 'w' }] }) }
  );
  const res = await request(appFor(repo)).get('/api/gates').expect(200);
  expect(res.body).toEqual({
    state: 'error',
    reason: 'gates does not match its format: waiting[0].position must be a whole number from 1',
  });
});

// The page polls every 20 s from every open tab, on the same event loop that ingests every session's events.
describe('one build at a time, cached for ten seconds', () => {
  const counted = () => {
    const repo = repoWith({ gates: { command: ['node', 'gates.js'] } });
    const counter = path.join(repo, 'runs.txt');
    fs.writeFileSync(
      path.join(repo, 'gates.js'),
      `require('fs').appendFileSync(${JSON.stringify(counter)}, 'x');
      setTimeout(() => console.log(JSON.stringify({ format: 1, running: [], waiting: [] })), 300);`
    );
    return { repo, runs: () => fs.readFileSync(counter, 'utf8').length };
  };

  test('two polls during one slow build share it: the feed runs once', async () => {
    const { repo, runs } = counted();
    const app = appFor(repo);
    const [a, b] = await Promise.all([request(app).get('/api/gates'), request(app).get('/api/gates')]);
    expect([a.body.state, b.body.state]).toEqual(['data', 'data']);
    expect(runs()).toBe(1);
  });

  test('a poll inside the ten seconds is served from the cache; with no cache every poll runs the feed', async () => {
    const cached = counted();
    const app = appFor(cached.repo);
    await request(app).get('/api/gates');
    await request(app).get('/api/gates');
    expect(cached.runs()).toBe(1);
    const fresh = counted();
    const noCache = appFor(fresh.repo, { gatesTtlMs: 0 });
    await request(noCache).get('/api/gates');
    await request(noCache).get('/api/gates');
    expect(fresh.runs()).toBe(2);
  });
});

// The production caller: server.js hands the collector nothing about gates any more, so the route must work
// from the repo's own flowwatch.json alone.
test('started by server.js on the fixture repo, /api/gates reads its feed', async () => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-gates-logs-'));
  const srv = await startServer({ port: 0, repoRoot: FIXTURE, dbPath: ':memory:', watchMs: 0, logDir });
  try {
    const body = await fetch('http://127.0.0.1:' + srv.port + '/api/gates').then((r) => r.json());
    expect(body.state).toBe('data');
    expect(body.running).toHaveLength(1);
  } finally {
    await srv.close();
  }
});
