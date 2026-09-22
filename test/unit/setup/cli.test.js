// `npx flowwatch check` is an agent's done-check: the banner's list in words, each
// open item with the SETUP.md step that fixes it, and exit 1 exactly while the banner would show.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.resolve(__dirname, '..', '..', '..', 'bin', 'flowwatch.js');
const run = (repoRoot) =>
  spawnSync(process.execPath, [CLI, 'check', '--repo', repoRoot], {
    encoding: 'utf8',
    env: { ...process.env, FLOWWATCH_PORT: '1' },
    windowsHide: true,
  });

test('in an empty repo it lists what is missing with its step, says the collector is not reachable, and exits 1', () => {
  const out = run(fs.mkdtempSync(path.join(os.tmpdir(), 'cli-')));
  expect(out.status).toBe(1);
  expect(out.stdout).toMatch(
    /✗ The mission \(MISSION\.md\) — no MISSION\.md at the repo root or in docs\/ {2}→ SETUP\.md step 3 Write the mission/
  );
  expect(out.stdout).toMatch(/✗ Session tracking hooks — .* {2}→ SETUP\.md step 5 Session tracking/);
  expect(out.stdout).toMatch(/○ Stages panel — not in flowwatch\.json {2}→ SETUP\.md step 4 Optional panels/);
  expect(out.stdout).toMatch(/○ Gates panel — not in flowwatch\.json {2}→ SETUP\.md step 4 Optional panels/);
  expect(out.stdout).toMatch(/Collector: not reachable on :1/);
  expect(out.stdout).toMatch(/Not set up yet: 2 required items/);
});

// On a box that already runs Flowwatch, :4477 answers — for the other repo. The check must not read
// that as "running": this repo's session events would land in the other repo's board.
test("a collector on this repo's port that serves another repo is named as such", async () => {
  const http = require('http');
  const { spawn } = require('child_process');
  const other = path.join(os.tmpdir(), 'some-other-repo');
  const server = http.createServer((req, res) => res.end(JSON.stringify({ repoRoot: other, lastEventAt: Date.now() })));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  let stdout = '';
  try {
    await new Promise((resolve) => {
      // spawned, so this process's server can answer while it runs
      const child = spawn(
        process.execPath,
        [CLI, 'check', '--repo', fs.mkdtempSync(path.join(os.tmpdir(), 'cli-mine-'))],
        { env: { ...process.env, FLOWWATCH_PORT: String(server.address().port) }, windowsHide: true }
      );
      child.stdout.on('data', (d) => (stdout += d));
      child.on('close', resolve);
    });
  } finally {
    server.close();
  }
  expect(stdout).toContain('is the collector of ' + other + ', not this repo');
  expect(stdout).not.toMatch(/Collector: running/);
});

// An older Flowwatch on the port has no /api/setup: its 404 page must not read as "no answer" and the
// check must not say "running on :4477" — it would be calling another repo's collector this repo's.
test('something on the port that is not this version of Flowwatch is not called "running"', async () => {
  const http = require('http');
  const { spawn } = require('child_process');
  const server = http.createServer((req, res) => {
    res.statusCode = 404;
    res.end('<pre>Cannot GET /api/setup</pre>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  let stdout = '';
  try {
    await new Promise((resolve) => {
      // spawned, so this process's server can answer while it runs
      const child = spawn(
        process.execPath,
        [CLI, 'check', '--repo', fs.mkdtempSync(path.join(os.tmpdir(), 'cli-old-'))],
        { env: { ...process.env, FLOWWATCH_PORT: String(server.address().port) }, windowsHide: true }
      );
      child.stdout.on('data', (d) => (stdout += d));
      child.on('close', resolve);
    });
  } finally {
    server.close();
  }
  expect(stdout).toMatch(/answers, but not as this repo's Flowwatch/);
  expect(stdout).not.toMatch(/Collector: running/);
});

test('in a set-up repo everything required is done, and it exits 0', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-set-up-'));
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  };
  fs.mkdirSync(path.join(repo, 'docs'));
  fs.copyFileSync(
    path.join(__dirname, '..', '..', 'fixtures', 'repo', 'MISSION.md'),
    path.join(repo, 'docs', 'MISSION.md')
  );
  put('flowwatch.json', '{"stages": false, "ideas": false, "value": false, "gates": false, "openspec": false}');
  put('node_modules/flowwatch/hooks/emit.js', '// emitter');
  put(
    '.claude/settings.json',
    JSON.stringify({
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/node_modules/flowwatch/hooks/emit.js" || true' },
            ],
          },
        ],
      },
    })
  );
  const out = run(repo);
  expect(out.status).toBe(0);
  expect(out.stdout).toMatch(/✓ The mission \(MISSION\.md\) — docs\/MISSION\.md/);
  expect(out.stdout).toMatch(/Set up\./);
});
