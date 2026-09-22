// Two states that are easy to misreport:
// 1. A MISSION.md or flowwatch.json that exists but cannot be read is a broken read, not "not there": it
//    must not show "No mission yet" with the setup check agreeing.
// 2. "openspec": false reads nothing, not even a leftover openspec/specs folder, or the headline stats count
//    specs the setup check calls "turned off".
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { openDb } = require('../../../server/db');
const { createApp } = require('../../../server/collector');
const { missionOf } = require('../../../server/repo/missionFile');
const { readWiring } = require('../../../server/repo/settings');
const { feedSource } = require('../../../server/feeds');
const { checkSetup } = require('../../../server/setup/checkSetup');

const repo = () => fs.mkdtempSync(path.join(os.tmpdir(), 'unread-'));
const byId = (r) => Object.fromEntries(r.items.map((i) => [i.id, i]));

// A directory where the file should be: exists, and every read of it fails (EISDIR) on every platform.
test('a MISSION.md that exists but cannot be read is reported as unreadable, never as missing', () => {
  const r = repo();
  fs.mkdirSync(path.join(r, 'MISSION.md'));
  const m = missionOf(r);
  expect(m.file).toBe('MISSION.md');
  expect(m.problems).toEqual([expect.stringMatching(/^MISSION\.md could not be read: /)]);
  expect(m.template).toBeUndefined();
  const i = byId(checkSetup({ repoRoot: r }));
  expect(i.mission.state).toBe('ok'); // it is there
  expect(i['mission-problems'].state).toBe('problem'); // and it is broken: the banner shows, the check fails
});

test('a flowwatch.json that exists but cannot be read is an error in every panel it wires, not "not set up"', () => {
  const r = repo();
  fs.mkdirSync(path.join(r, 'flowwatch.json'));
  const w = readWiring(r);
  expect([w.file, w.config]).toEqual(['flowwatch.json', null]);
  for (const key of ['stages', 'ideas', 'value', 'gates']) {
    expect(feedSource(r, w, key)).toMatchObject({
      state: 'error',
      reason: expect.stringMatching(/^flowwatch\.json could not be read: /),
    });
  }
  const setup = byId(checkSetup({ repoRoot: r }));
  expect([setup.stages, setup.gates]).toEqual([undefined, undefined]); // the wiring item says it once
  expect(setup.wiring).toMatchObject({ state: 'problem', detail: expect.stringMatching(/could not be read/) });
});

test('"openspec": false reads no specs, even from a leftover openspec folder', async () => {
  const r = repo();
  fs.mkdirSync(path.join(r, 'openspec', 'specs'), { recursive: true });
  fs.writeFileSync(path.join(r, 'openspec', 'specs', 'stale.feature'), '@implemented\nScenario: old\n');
  fs.writeFileSync(path.join(r, 'flowwatch.json'), '{"openspec": false}');
  const res = await request(createApp(openDb(':memory:'), { repoRoot: r, mcTtlMs: 0 }))
    .get('/api/mission')
    .expect(200);
  expect(res.body.capabilities).toEqual({});
  expect(res.body.totals.total).toBe(0);
  expect(res.body.panels.specs).toEqual({ state: 'off' });
  expect(res.body.sources).toMatchObject({ specs: false, changes: false });
});

// The page: with Specs off the three spec figures are hidden rather than showing zeros, and come back on.
test('the page hides the spec figures while Specs is off, and shows them again when it is on', () => {
  const vm = require('vm');
  const tile = () => ({ hidden: false });
  const tiles = { total: tile(), implemented: tile(), 'active-changes': tile() };
  const bars = { innerHTML: '' };
  const sandbox = {
    document: {
      getElementById: (id) => (id === 'spec-bars' ? bars : null),
      querySelector: (sel) => {
        const k = sel.match(/data-bind="([^"]+)"/)[1];
        return tiles[k] ? { closest: () => tiles[k] } : null;
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', '..', '..', 'web', 'lib', 'render.js'), 'utf8') +
      '\n;this.__rs = renderSpecBars;',
    sandbox
  );
  sandbox.__rs({}, { specs: false }, { state: 'off' });
  expect(Object.values(tiles).map((t) => t.hidden)).toEqual([true, true, true]);
  expect(bars.innerHTML).toMatch(/turns it off/);
  sandbox.__rs(
    { a: { implemented: 1, known_broken: 0, aspirational: 0, total: 1 } },
    { specs: true },
    { state: 'data' }
  );
  expect(Object.values(tiles).map((t) => t.hidden)).toEqual([false, false, false]);
  expect(bars.innerHTML).toMatch(/1\/1/);
});

// A broken flowwatch.json may be the one saying "openspec": false, so Specs is an error like every
// panel the file wires, and nothing is read from the default folder meanwhile.
test('a broken flowwatch.json makes Specs an error too, and reads no leftover specs', async () => {
  const r = repo();
  fs.mkdirSync(path.join(r, 'openspec', 'specs'), { recursive: true });
  fs.writeFileSync(path.join(r, 'openspec', 'specs', 'stale.feature'), '@implemented\nScenario: old\n');
  fs.writeFileSync(path.join(r, 'flowwatch.json'), '{ "openspec": fal');
  const res = await request(createApp(openDb(':memory:'), { repoRoot: r, mcTtlMs: 0 }))
    .get('/api/mission')
    .expect(200);
  expect(res.body.panels.specs).toEqual({
    state: 'error',
    reason: expect.stringMatching(/^flowwatch\.json is not valid JSON: /),
  });
  expect(res.body.totals.total).toBe(0);
  expect(byId(checkSetup({ repoRoot: r })).specs).toBeUndefined();
});

// The "read nothing" rule holds when a caller gives one folder explicitly, too: the other one is not
// read from a leftover folder.
test('"openspec": false reads no changes when only the specs folder is given explicitly', async () => {
  const r = repo();
  fs.mkdirSync(path.join(r, 'openspec', 'changes', 'stale-change'), { recursive: true });
  fs.writeFileSync(path.join(r, 'flowwatch.json'), '{"openspec": false}');
  const app = createApp(openDb(':memory:'), { repoRoot: r, specsDir: path.join(r, 'nowhere'), mcTtlMs: 0 });
  const res = await request(app).get('/api/mission').expect(200);
  expect(res.body.activeChanges).toBe(0);
  expect(res.body.sources.changes).toBe(false);
});
