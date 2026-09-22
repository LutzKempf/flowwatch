// A repo's own settings reach every payload they shape, through the production caller (startServer): its
// MISSION.md categories own its specs, its flowwatch.json names the module that infers the rest. The fixture is a
// made-up repo (test/fixtures/repo) that uses each setting.
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { startServer } = require('../../server/server');

const SERVED_REPO = path.join(__dirname, '..', 'fixtures', 'repo');

let root;
let srv;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-settings-'));
});
afterEach(async () => {
  if (srv) {
    await srv.close();
    srv = null;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};

// One session waiting on the operator, whose title names no category: only an inference can file it.
function sessions() {
  const repoRoot = path.join(root, 'checkout');
  const appDir = path.join(root, 'app');
  write(
    appDir,
    'local_1.json',
    JSON.stringify({
      sessionId: 'local_1',
      cliSessionId: 'cli-1',
      cwd: path.join(repoRoot, '.claude', 'worktrees', 'wt-a'),
      title: 'Tidy the page',
      branch: 'claude/basket-page',
      lastActivityAt: Date.now(),
    })
  );
  write(
    path.join(root, 'projects', 'p'),
    'cli-1.jsonl',
    JSON.stringify({
      type: 'assistant',
      timestamp: new Date().toISOString(),
      message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'Done. Merge it?' }] },
    }) + '\n'
  );
  return { appDir, projectsDir: path.join(root, 'projects'), repoRoot, ttlMs: 0, skillsDir: path.join(root, 'skills') };
}

async function serve(repoRoot, inbox) {
  srv = await startServer({
    port: 0,
    dbPath: ':memory:',
    watchMs: 0,
    logDir: path.join(root, 'logs'),
    repoRoot,
    inbox,
  });
  return request(`http://127.0.0.1:${srv.port}`);
}

describe('the fixture repo, served', () => {
  test("a session whose title names no category is filed by the repo's categorize module, on the inbox and its card", async () => {
    const api = await serve(SERVED_REPO, sessions());
    await api
      .post('/events')
      .send({ id: 'e1', session_id: 'cli-1', worktree: 'wt-a', ts: Date.now(), type: 'session_start' })
      .expect(200);
    const inbox = (await api.get('/api/inbox').expect(200)).body;
    expect(inbox.items[0]).toMatchObject({ title: 'Tidy the page', category: 'Checkout', category_from: 'inferred' });
    const lanes = (await api.get('/api/lanes').expect(200)).body;
    const checkout = lanes.lanes.find((l) => l.name === 'Checkout');
    expect(checkout.sessions.map((s) => [s.id, s.category_from])).toEqual([['cli-1', 'inferred']]);
  });

  test('its specs sit on the cards of the categories that own them, and its change goes with them', async () => {
    const api = await serve(SERVED_REPO, sessions());
    const lanes = (await api.get('/api/lanes').expect(200)).body;
    expect(lanes.capability_lanes_from).toBe('categories');
    const byName = Object.fromEntries(lanes.lanes.map((l) => [String(l.name), l]));
    expect(byName.Checkout.specs.map((s) => [s.capability, s.lane_from])).toEqual([['checkout-flow', 'categories']]);
    expect(byName.Payments.specs.map((s) => [s.capability, s.lane_from])).toEqual([['payment-methods', 'categories']]);
    const checkoutStories = [...byName.Checkout.stories, ...byName.Checkout.older];
    expect(checkoutStories).toEqual([
      expect.objectContaining({ topic: '2026-09-01-guest-form', under: ['checkout-flow'] }),
    ]);
  });

  test('the Mission page counts its change under the category owning the spec it edits', async () => {
    const api = await serve(SERVED_REPO, sessions());
    const mc = (await api.get('/api/mission').expect(200)).body;
    expect(mc.changesByLane).toEqual({ Checkout: 1 });
    expect(mc.mission.categorySpecs.Checkout).toEqual(['checkout-flow', 'cart-*']);
  });

  test('the Cleanup hand-off names its cleanup skill, and says whether this box has it', async () => {
    const inbox = sessions();
    const api = await serve(SERVED_REPO, inbox);
    expect((await api.get('/api/lanes').expect(200)).body.cleanup_skill).toEqual({ name: 'tidy-up', state: 'missing' });
    write(inbox.skillsDir, path.join('tidy-up', 'SKILL.md'), '---\nname: tidy-up\n---\n');
    expect((await api.get('/api/lanes').expect(200)).body.cleanup_skill).toEqual({
      name: 'tidy-up',
      state: 'installed',
    });
  });

  test('the setup check loads its categorize module', async () => {
    const api = await serve(SERVED_REPO, sessions());
    const setup = (await api.get('/api/setup').expect(200)).body;
    expect(setup.items.find((i) => i.id === 'categorize')).toMatchObject({
      state: 'ok',
      detail: 'infers the rest with scripts/categorize.js',
    });
  });
});

describe('a repo whose categorize module is broken', () => {
  const repoWith = (files) => {
    const repo = path.join(root, 'served');
    write(repo, 'MISSION.md', '# Shop\n\nCustomers pay.\n\n## Categories\n- Checkout — specs: checkout-flow\n');
    for (const [rel, text] of Object.entries(files)) write(repo, rel, text);
    return repo;
  };

  test('a module that throws on load costs the inferred categories and nothing else, and the setup check names it', async () => {
    const repo = repoWith({
      'flowwatch.json': '{"sessions": {"categorize": "scripts/categorize.js"}}',
      'scripts/categorize.js': 'throw new Error("no settings file");',
    });
    const api = await serve(repo, sessions());
    const inbox = (await api.get('/api/inbox').expect(200)).body;
    expect(inbox.items[0]).toMatchObject({ title: 'Tidy the page', category: null, category_from: null });
    await api.get('/api/lanes').expect(200);
    await api.get('/api/mission').expect(200);
    const setup = (await api.get('/api/setup').expect(200)).body;
    expect(setup.items.find((i) => i.id === 'categorize')).toMatchObject({
      state: 'problem',
      detail: 'scripts/categorize.js could not be loaded: no settings file',
    });
  });

  // Only flowwatch.json names the inference module: a module at a conventional path is not picked up on its own.
  test('a module at a conventional path is not read when flowwatch.json does not name it', async () => {
    const repo = repoWith({
      'scripts/session-title-normalizer.js': 'module.exports = { inferCategory: () => "Checkout" };',
    });
    const api = await serve(repo, sessions());
    const inbox = (await api.get('/api/inbox').expect(200)).body;
    expect(inbox.items[0]).toMatchObject({ category: null, category_from: null });
  });
});

// Where the app keeps its records is the platform's folder unless flowwatch.json names one; the resolution per
// platform is pinned in appRecordsDir.test.js. Here: the setting reaches the collector through startServer.
describe("the app's session records folder", () => {
  const served = (appRecords) => {
    const repo = path.join(root, 'served');
    write(repo, 'MISSION.md', '# Shop\n\nCustomers pay.\n');
    write(repo, 'flowwatch.json', JSON.stringify({ sessions: { appRecords } }));
    return repo;
  };
  const withoutAppDir = () => {
    const { appDir, ...rest } = sessions();
    return { appDir, inbox: rest };
  };

  test('flowwatch.json "sessions.appRecords" is where the inbox and the lane cards read the records', async () => {
    const { appDir, inbox } = withoutAppDir();
    const api = await serve(served(appDir), inbox);
    const body = (await api.get('/api/inbox').expect(200)).body;
    expect(body.items.map((i) => i.title)).toEqual(['Tidy the page']);
    expect(body.records_folder).toEqual({
      found: true,
      looked: 'looked in ' + appDir + ' (flowwatch.json "sessions.appRecords")',
    });
    await api
      .post('/events')
      .send({ id: 'e1', session_id: 'cli-1', worktree: 'wt-a', ts: Date.now(), type: 'session_start' })
      .expect(200);
    const lanes = (await api.get('/api/lanes').expect(200)).body;
    expect(lanes.titles['cli-1']).toMatchObject({ title: 'Tidy the page' });
  });

  test('a records folder that is not there is said, with where it looked, and nothing fails', async () => {
    const { inbox } = withoutAppDir();
    const gone = path.join(root, 'no-app-here');
    const api = await serve(served(gone), inbox);
    const body = (await api.get('/api/inbox').expect(200)).body;
    expect(body.items).toEqual([]);
    expect(body.records_folder).toEqual({
      found: false,
      looked: 'looked in ' + gone + ' (flowwatch.json "sessions.appRecords")',
    });
    await api.get('/api/lanes').expect(200);
  });
});
