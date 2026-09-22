// On a box that already runs Flowwatch, a second repo's session hooks would POST to :4477 and append to
// ~/.flowwatch/logs — the first repo's collector and the log folder it replays on boot — so the new repo's
// sessions would land in the other repo's board. A repo can name its own port and data folder in
// flowwatch.json; the emitter and the collector both read it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { collectorConfig } = require('../../../hooks/lib/collectorConfig');

const repo = () => fs.mkdtempSync(path.join(os.tmpdir(), 'collector-cfg-'));
const put = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};

test('no setting, no file, a broken file or no project dir: the defaults (null), never a throw', () => {
  const r = repo();
  expect(collectorConfig(r)).toEqual({ port: null, dataDir: null });
  put(r, 'flowwatch.json', '{ nope');
  expect(collectorConfig(r)).toEqual({ port: null, dataDir: null });
  expect(collectorConfig(undefined)).toEqual({ port: null, dataDir: null });
});

test("the repo's port and data folder, from the root or docs/, the folder anchored to the repo", () => {
  const r = repo();
  put(r, 'docs/flowwatch.json', '{"collector": {"port": 4479, "dataDir": ".flowwatch-data"}}');
  expect(collectorConfig(r)).toEqual({ port: 4479, dataDir: path.join(r, '.flowwatch-data') });
  put(r, 'flowwatch.json', '{"collector": {"port": 0, "dataDir": ""}}'); // the root wins; unusable values are ignored
  expect(collectorConfig(r)).toEqual({ port: null, dataDir: null });
});

// Spawned, not execFileSync: a blocking child would freeze this process's server and the POST would time out.
test('a hook in a repo with its own collector posts there and logs into its data folder', async () => {
  const got = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      got.push(JSON.parse(b));
      res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const r0 = repo();
  put(r0, 'flowwatch.json', JSON.stringify({ collector: { port: server.address().port, dataDir: '.dp' } }));
  const env = { ...process.env, CLAUDE_PROJECT_DIR: r0 };
  delete env.FLOWWATCH_PORT;
  delete env.FLOWWATCH_DATA_DIR;
  try {
    await new Promise((resolve) => {
      const child = spawn(process.execPath, [path.resolve(__dirname, '..', '..', '..', 'hooks', 'emit.js')], {
        env,
        windowsHide: true,
      });
      child.on('close', resolve);
      child.stdin.end(
        JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'own-1', cwd: '/r/.claude/worktrees/wt-own' })
      );
    });
  } finally {
    server.close();
  }
  expect(got.map((e) => e.session_id)).toEqual(['own-1']);
  expect(fs.readFileSync(path.join(r0, '.dp', 'logs', 'wt-own.log.jsonl'), 'utf8')).toMatch(/"own-1"/);
});
