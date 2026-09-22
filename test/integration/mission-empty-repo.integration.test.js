// A repo with nothing in it yet is a state, not a failure: the route answers 200 with what is missing and the
// mission it can read, never a 500 the page would show as "collector offline".
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { openDb } = require('../../server/db');
const { createApp } = require('../../server/collector');

const emptyRepo = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mc-empty-'));
const appFor = (repoRoot) => createApp(openDb(':memory:'), { repoRoot, mcTtlMs: 0 });

test('an empty repo gets a 200 that says no mission and no specs yet, with the mission template to start from', async () => {
  const res = await request(appFor(emptyRepo())).get('/api/mission').expect(200);
  expect(res.body.mission).toMatchObject({ file: null, title: null, statement: null, problems: [] });
  expect(res.body.mission.template).toMatch(/^# <What this repo is trying to achieve/);
  expect(res.body.sources).toMatchObject({ mission: null, specs: false, changes: false });
  expect(res.body.capabilities).toEqual({});
  expect(res.body.totals.total).toBe(0);
});

test('a MISSION.md at the root is the mission, and the template is not sent', async () => {
  const repo = emptyRepo();
  fs.writeFileSync(path.join(repo, 'MISSION.md'), '# Ship the thing\n\nPeople can use it.\n\n## Milestones\n- Nope\n');
  const res = await request(appFor(repo)).get('/api/mission').expect(200);
  expect(res.body.mission).toMatchObject({
    file: 'MISSION.md',
    title: 'Ship the thing',
    statement: 'People can use it.',
  });
  expect(res.body.mission.problems).toEqual(['milestone line has no `id` and was left out: "Nope"']);
  expect(res.body.mission.template).toBeUndefined();
  expect(res.body.sources.mission).toBe('MISSION.md');
});

// The optional panels read their sources only when flowwatch.json says where they are; otherwise
// they say so, rather than drawing an empty board that reads as "nothing started".
test('with no flowwatch.json the optional panels are not set up, and nothing is read for them', async () => {
  const res = await request(appFor(emptyRepo())).get('/api/mission').expect(200);
  expect(res.body.panels).toEqual({
    stages: { state: 'not-set-up' },
    ideas: { state: 'not-set-up' },
    value: { state: 'not-set-up' },
    specs: { state: 'not-set-up' },
  });
  expect([res.body.stages, res.body.ideas, res.body.value]).toEqual([null, null, null]);
  expect(res.body.sources.wiring).toBeNull();
});

test('turned off, or broken, each panel says which', async () => {
  const off = emptyRepo();
  fs.writeFileSync(
    path.join(off, 'flowwatch.json'),
    '{"stages": false, "ideas": false, "value": false, "openspec": false}'
  );
  const a = await request(appFor(off)).get('/api/mission').expect(200);
  expect(Object.values(a.body.panels).map((p) => p.state)).toEqual(['off', 'off', 'off', 'off']);

  const broken = emptyRepo();
  fs.mkdirSync(path.join(broken, 'docs'));
  fs.writeFileSync(path.join(broken, 'docs', 'flowwatch.json'), '{ "stages": ');
  const b = await request(appFor(broken)).get('/api/mission').expect(200);
  expect(b.body.sources.wiring).toBe('docs/flowwatch.json');
  for (const p of Object.values(b.body.panels)) expect(p.reason).toMatch(/^flowwatch\.json is not valid JSON: /);
});

test('one in docs/ is found too, as some repos keep it', async () => {
  const repo = emptyRepo();
  fs.mkdirSync(path.join(repo, 'docs'));
  fs.writeFileSync(path.join(repo, 'docs', 'MISSION.md'), '# Self-serve checkout\n\nCustomers finish their orders.\n');
  const res = await request(appFor(repo)).get('/api/mission').expect(200);
  expect(res.body.mission).toMatchObject({ file: 'docs/MISSION.md', title: 'Self-serve checkout' });
});
