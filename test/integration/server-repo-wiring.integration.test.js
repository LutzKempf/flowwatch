// Through startServer, the production caller, not the collector alone: a default folder passed in there
// would win over the repo's flowwatch.json, and an empty repo's panels would read some other repo's
// folders. Route tests that build the collector directly cannot see that.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer } = require('../../server/server');

let srv;
afterEach(async () => {
  if (srv) await srv.close();
  srv = null;
});

async function missionPayloadOf(repoRoot) {
  srv = await startServer({ port: 0, repoRoot, dbPath: ':memory:', watchMs: 0, logDir: path.join(repoRoot, 'logs') });
  return fetch('http://127.0.0.1:' + srv.port + '/api/mission').then((r) => r.json());
}

test('started on an empty repo, the optional panels are not set up: no other repo is read', async () => {
  const mc = await missionPayloadOf(fs.mkdtempSync(path.join(os.tmpdir(), 'srv-empty-')));
  expect(mc.panels).toEqual({
    stages: { state: 'not-set-up' },
    ideas: { state: 'not-set-up' },
    value: { state: 'not-set-up' },
    specs: { state: 'not-set-up' },
  });
  expect(mc.stages).toBeNull();
  expect(mc.sources).toMatchObject({ mission: null, specs: false, changes: false, wiring: null });
});

// The `flowwatch` command names the repo it serves. A caller that names none gets the folder the process was
// started in — never the folder the module sits in, which for an installed package is node_modules/flowwatch.
// So each test starts the server from inside a temp copy of a made-up repo, and puts the cwd back at once.
const FIXTURE_REPO = path.join(__dirname, '..', 'fixtures', 'repo');
const repoCopy = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-cwd-'));
  fs.cpSync(FIXTURE_REPO, dir, { recursive: true });
  return dir;
};
async function missionStartedIn(dir, opts = {}) {
  const before = process.cwd();
  try {
    process.chdir(dir);
    srv = await startServer({ port: 0, dbPath: ':memory:', watchMs: 0, logDir: path.join(dir, 'logs'), ...opts });
  } finally {
    process.chdir(before);
  }
  return fetch('http://127.0.0.1:' + srv.port + '/api/mission').then((r) => r.json());
}

test('with no repoRoot given, the server reads the folder it was started in', async () => {
  const mc = await missionStartedIn(repoCopy());
  expect(mc.sources.mission).toBe('MISSION.md');
  expect(mc.mission.categories).toContain('Retro');
});

test('an explicit repoRoot wins over the folder the server was started in', async () => {
  const mc = await missionStartedIn(repoCopy(), { repoRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'srv-named-')) });
  expect(mc.sources.mission).toBeNull();
  expect(mc.mission.categories).toEqual([]);
});

// A second repo on the box keeps its own database and replays only its own append-logs.
test('a repo that names its collector data folder gets its own database, and replays its own logs', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-own-'));
  fs.writeFileSync(path.join(repo, 'flowwatch.json'), '{"collector": {"dataDir": ".dp"}}');
  fs.mkdirSync(path.join(repo, '.dp', 'logs'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.dp', 'logs', 'wt-own.log.jsonl'),
    JSON.stringify({ id: 'e-own', session_id: 'own-1', worktree: 'wt-own', ts: Date.now(), type: 'session_start' }) +
      '\n'
  );
  const env = process.env.FLOWWATCH_DATA_DIR;
  delete process.env.FLOWWATCH_DATA_DIR;
  try {
    srv = await startServer({ port: 0, repoRoot: repo, watchMs: 0 });
  } finally {
    if (env !== undefined) process.env.FLOWWATCH_DATA_DIR = env;
  }
  expect(fs.existsSync(path.join(repo, '.dp', 'pipeline.db'))).toBe(true);
  expect(fs.existsSync(path.join(repo, '.dp', 'logs', 'wt-own.log.jsonl.replayed'))).toBe(true);
  const setup = await fetch('http://127.0.0.1:' + srv.port + '/api/setup').then((r) => r.json());
  expect(setup.lastEventAt).toEqual(expect.any(Number));
  expect(setup.repoRoot).toBe(repo);
});

test('started on a repo whose flowwatch.json moves openspec, the server reads it from there', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-wired-'));
  fs.mkdirSync(path.join(repo, 'spec', 'caps'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'spec', 'caps', 'thing.feature'), '@implemented\nScenario: works\n');
  fs.writeFileSync(path.join(repo, 'flowwatch.json'), '{"openspec": {"specs": "spec/caps"}, "stages": false}');
  const mc = await missionPayloadOf(repo);
  expect(mc.sources.specs).toBe(true);
  expect(Object.keys(mc.capabilities)).toEqual(['thing']);
  expect(mc.panels.stages).toEqual({ state: 'off' });
});
