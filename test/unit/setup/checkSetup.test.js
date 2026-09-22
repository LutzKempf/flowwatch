// The setup check: one list of what is set up for Flowwatch in a repo, for the
// pages' banner and for `npx flowwatch check`, so the page and an agent can never disagree.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkSetup } = require('../../../server/setup/checkSetup');

const repo = () => fs.mkdtempSync(path.join(os.tmpdir(), 'setup-'));
const put = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const HOOKS = (cmd) => JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: cmd }] }] } });
const EMIT = 'node "$CLAUDE_PROJECT_DIR/node_modules/flowwatch/hooks/emit.js" || true';
const byId = (r) => Object.fromEntries(r.items.map((i) => [i.id, i]));

test('an empty repo: the mission and the hooks are missing, the optional parts not set up, and the banner lists what to do', () => {
  const r = checkSetup({ repoRoot: repo() });
  const i = byId(r);
  expect([i.mission.state, i.hooks.state, i.wiring.state]).toEqual(['missing', 'missing', 'ok']);
  expect([i.stages.state, i.ideas.state, i.value.state, i.gates.state, i.specs.state]).toEqual([
    'not-set-up',
    'not-set-up',
    'not-set-up',
    'not-set-up',
    'not-set-up',
  ]);
  expect(i['mission-problems']).toBeUndefined(); // nothing to read yet
  expect(r.banner.map((b) => b.id)).toEqual(['mission', 'hooks', 'stages', 'ideas', 'value', 'gates', 'specs']);
  expect(r.ok).toBe(false);
  for (const b of r.banner) expect(b.step).toMatch(/^[2-6] /); // every item names the SETUP.md step that fixes it
});

test('a set-up repo: no banner, and optional parts turned off stay quiet', () => {
  const r0 = repo();
  put(r0, 'MISSION.md', '# Ship it\n\nPeople pay.\n');
  put(r0, 'flowwatch.json', '{"stages": false, "ideas": false, "value": false, "gates": false}');
  put(r0, 'node_modules/flowwatch/hooks/emit.js', '// emitter');
  put(r0, '.claude/settings.json', HOOKS(EMIT));
  const r = checkSetup({ repoRoot: r0 });
  expect(r.banner).toEqual([]);
  expect(r.ok).toBe(true);
  expect(byId(r).hooks).toMatchObject({ state: 'ok', detail: expect.stringContaining('.claude/settings.json') });
});

test('the four required items each raise the banner on their own', () => {
  const setUp = () => {
    const r0 = repo();
    put(r0, 'MISSION.md', '# Ship it\n\nPeople pay.\n');
    put(r0, 'node_modules/flowwatch/hooks/emit.js', '// emitter');
    put(r0, '.claude/settings.local.json', HOOKS(EMIT));
    return r0;
  };
  const cases = {
    mission: (r0) => fs.rmSync(path.join(r0, 'MISSION.md')),
    'mission-problems': (r0) => put(r0, 'MISSION.md', '# Ship it\n\nPeople pay.\n\n## Milestones\n- no id here\n'),
    wiring: (r0) => put(r0, 'flowwatch.json', '{ nope'),
    hooks: (r0) => fs.rmSync(path.join(r0, 'node_modules', 'flowwatch', 'hooks', 'emit.js')),
  };
  for (const [id, breakIt] of Object.entries(cases)) {
    const r0 = setUp();
    expect(checkSetup({ repoRoot: r0 }).banner).toEqual([]); // clean before
    breakIt(r0);
    const r = checkSetup({ repoRoot: r0 });
    expect([id, r.ok, r.banner[0].id]).toEqual([id, false, id]);
  }
});

// A repo without openspec must be able to turn Specs off like every other optional panel, or it stays
// "not set up" forever. "openspec": false does that.
test('"openspec": false turns the Specs part off', () => {
  const r0 = repo();
  put(r0, 'flowwatch.json', '{"openspec": false}');
  expect(byId(checkSetup({ repoRoot: r0 })).specs).toMatchObject({
    state: 'off',
    detail: 'turned off in flowwatch.json',
  });
});

test('hooks that run an emitter which is not installed are a problem naming the path, not "installed"', () => {
  const r0 = repo();
  put(r0, '.claude/settings.json', HOOKS(EMIT));
  expect(byId(checkSetup({ repoRoot: r0 })).hooks).toMatchObject({
    state: 'problem',
    detail: expect.stringContaining('node_modules/flowwatch/hooks/emit.js'),
  });
});

// flowwatch.json "sessions.categorize" names the repo's own category inference. It is optional: without it,
// categories come from session titles. A module that does not load is named here, and the collector carries on.
test('the Session categories item loads the module the repo names, and names what is wrong with it', () => {
  const r0 = repo();
  expect(byId(checkSetup({ repoRoot: r0 })).categorize).toMatchObject({
    required: false,
    state: 'ok',
    title: 'Session categories',
    detail: expect.stringMatching(/^from session titles only/),
    step: expect.stringMatching(/^4 /),
  });
  put(r0, 'flowwatch.json', '{"sessions": {"categorize": "scripts/categorize.js"}}');
  expect(byId(checkSetup({ repoRoot: r0 })).categorize).toMatchObject({
    state: 'problem',
    detail: 'names scripts/categorize.js, which is not there',
  });
  put(r0, 'scripts/categorize.js', 'throw new Error("cannot start");');
  expect(byId(checkSetup({ repoRoot: r0 })).categorize).toMatchObject({
    state: 'problem',
    detail: 'scripts/categorize.js could not be loaded: cannot start',
  });
  // Optional: a broken module alone never raises the banner.
  put(r0, 'MISSION.md', '# Ship it\n\nPeople pay.\n');
  put(r0, 'node_modules/flowwatch/hooks/emit.js', '// emitter');
  put(r0, '.claude/settings.json', HOOKS(EMIT));
  expect(checkSetup({ repoRoot: r0 }).banner).toEqual([]);
});
