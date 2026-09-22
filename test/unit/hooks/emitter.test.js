// The hooks the installer writes run the emitter this package ships, and an event it is given reaches
// the collector and the append-log. The hooks end in `|| true`, so a wrong path would fail silently.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const fragment = require('../../../templates/hooks.json');

const ROOT = path.resolve(__dirname, '..', '..', '..');

test('every hook the installer writes runs the package emitter, and the files are there', () => {
  const commands = Object.values(fragment.hooks)
    .flat()
    .flatMap((e) => e.hooks.map((h) => h.command));
  expect(commands.length).toBeGreaterThan(0);
  for (const c of commands) expect(c).toBe('node "$CLAUDE_PROJECT_DIR/node_modules/flowwatch/hooks/emit.js" || true');
  expect(fragment.statusLine.command).toBe('node node_modules/flowwatch/hooks/statusline.js');
  for (const f of ['emit.js', 'statusline.js']) expect(fs.existsSync(path.join(ROOT, 'hooks', f))).toBe(true);
});

// Spawned, not execFileSync: a blocking child would freeze this process's server and the POST would time out.
function runEmitter(script, payload, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { env: { ...process.env, ...env }, windowsHide: true });
    child.on('close', resolve);
    child.stdin.end(JSON.stringify(payload));
  });
}

test('an event from hooks/emit.js reaches the collector and the append-log', async () => {
  const got = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      got.push([req.method, req.url, JSON.parse(body)]);
      res.end('{"ok":true}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emit-'));
  try {
    await runEmitter(
      path.join(ROOT, 'hooks', 'emit.js'),
      { hook_event_name: 'SessionStart', session_id: 'event-1', cwd: '/r/.claude/worktrees/wt-a', source: 'startup' },
      { FLOWWATCH_PORT: String(server.address().port), FLOWWATCH_DATA_DIR: dataDir, CLAUDE_PROJECT_DIR: dataDir }
    );
  } finally {
    server.close();
  }
  expect(got).toEqual([
    ['POST', '/events', expect.objectContaining({ session_id: 'event-1', worktree: 'wt-a', type: 'session_start' })],
  ]);
  expect(fs.readFileSync(path.join(dataDir, 'logs', 'wt-a.log.jsonl'), 'utf8')).toMatch(/"session_id":"event-1"/);
});
