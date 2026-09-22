// The Stages panel end to end: the repo's flowwatch.json names a feed, the collector reads it, and
// /api/mission serves the grid and the milestone statuses it drives — or, when the feed is broken, the
// reason, never an empty grid that reads as "nothing started".
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

test("the fixture repo's stages reach /api/mission, and its milestones follow their workstreams", async () => {
  const res = await get(FIXTURE);
  expect(res.body.panels.stages).toEqual({ state: 'data' });
  expect(res.body.stages.stages).toEqual(['idea', 'design', 'build', 'trial', 'rollout', 'live']);
  expect(res.body.stages.workstreams.map((w) => [w.id, w.frontier])).toEqual([
    ['guest-checkout', 5],
    ['saved-cards', 2],
  ]);
  expect(res.body.stages.workstreams[1].cells).toEqual(['passed', 'frontier', 'failed', 'none', 'none', 'none']);
  const status = Object.fromEntries(res.body.milestones.map((m) => [m.id, [m.frontier, m.status]]));
  expect(status['guest-checkout-live']).toEqual([5, 'rolling out']); // the feed's milestoneStatus label
  expect(status['saved-cards-live']).toEqual([2, 'designed']);
  expect(status['order-emails'][0]).toBeNull(); // no workstream: from its specs
});

test('a feed whose cells do not fit its stages puts the problem on the panel, and no grid in the payload', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-stages-'));
  fs.writeFileSync(path.join(repo, 'flowwatch.json'), JSON.stringify({ stages: { file: 'stages.json' } }));
  fs.writeFileSync(
    path.join(repo, 'stages.json'),
    JSON.stringify({ format: 1, stages: ['idea', 'build'], workstreams: [{ id: 'a', name: 'A', cells: ['passed'] }] })
  );
  const res = await get(repo);
  expect(res.body.panels.stages).toEqual({
    state: 'error',
    reason: 'stages does not match its format: workstreams[0] has 1 cells; it needs one per stage (2)',
  });
  expect(res.body.stages).toBeNull();
});
