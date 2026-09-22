// The `flowwatch` command: one entry point for starting the dashboard, checking a repo's setup and
// installing the session hooks, always against a named repo — the git repository it runs in, or --repo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { version } = require('../../../package.json');

const BIN = path.resolve(__dirname, '..', '..', '..', 'bin', 'flowwatch.js');
// A git fixture must not inherit the GIT_* variables of whatever process runs the tests.
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const run = (args, opts = {}) =>
  spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    ...opts,
    env: { ...cleanEnv(), FLOWWATCH_PORT: '1', ...opts.env },
  });
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));

test('--help lists the four commands and exits 0', () => {
  const out = run(['--help']);
  expect(out.status).toBe(0);
  expect(out.stdout).toMatch(/Usage: flowwatch <command> \[--repo <folder>\]/);
  for (const c of ['start', 'check', 'install-hooks', 'demo'])
    expect(out.stdout).toMatch(new RegExp('^  ' + c + ' ', 'm'));
});

test('--help says where the demo is served and what it shows', () => {
  const out = run(['--help']);
  expect(out.stdout).toMatch(/^ {2}demo +.*http:\/\/127\.0\.0\.1:4478\/flowwatch\//m);
  expect(out.stdout).toMatch(/^ {2}--data <folder> +demo: /m);
  expect(out.stdout).toMatch(/^ {2}--port <n> +demo: .*4478/m);
});

test('demo refuses a port that is not a number, and an option with no value', () => {
  expect(run(['demo', '--port', 'soon'])).toMatchObject({
    status: 1,
    stderr: expect.stringMatching(/^flowwatch: --port needs a number/),
  });
  expect(run(['demo', '--data'])).toMatchObject({
    status: 1,
    stderr: expect.stringMatching(/^flowwatch: --data needs a folder/),
  });
});

test('--version prints the package version', () => {
  const out = run(['--version']);
  expect([out.status, out.stdout.trim()]).toEqual([0, version]);
});

test('no command, or an unknown one, prints the usage to stderr and exits 1', () => {
  expect(run([])).toMatchObject({ status: 1, stderr: expect.stringMatching(/Usage: flowwatch/) });
  const out = run(['launch']);
  expect(out.status).toBe(1);
  expect(out.stderr).toMatch(/^flowwatch: unknown command "launch"/);
});

test('check without --repo checks the git repository it runs in, from any folder inside it', () => {
  const repo = tmp('fw-bin-git-');
  execFileSync('git', ['init', '-q'], { cwd: repo, env: cleanEnv() });
  fs.mkdirSync(path.join(repo, 'src', 'deep'), { recursive: true });
  const out = run(['check'], { cwd: path.join(repo, 'src', 'deep') });
  expect(out.status).toBe(1); // nothing set up yet
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: repo,
    encoding: 'utf8',
    env: cleanEnv(),
  }).trim();
  expect(out.stdout.split('\n')[0]).toBe('Flowwatch setup in ' + path.resolve(top));
});

test('install-hooks writes hooks that run the installed package emitter', () => {
  const repo = tmp('fw-bin-hooks-');
  const out = run(['install-hooks', '--repo', repo]);
  expect(out.status).toBe(0);
  const settings = JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8'));
  const commands = Object.values(settings.hooks)
    .flat()
    .flatMap((e) => e.hooks.map((h) => h.command));
  expect(commands.length).toBeGreaterThan(0);
  for (const c of commands) expect(c).toBe('node "$CLAUDE_PROJECT_DIR/node_modules/flowwatch/hooks/emit.js" || true');
  expect(settings.statusLine.command).toBe('node node_modules/flowwatch/hooks/statusline.js');
});

test('install-hooks leaves a repo alone whose hooks already run an emitter of its own, so no event counts twice', () => {
  const repo = tmp('fw-bin-own-');
  const script = path.join(repo, 'scripts', 'tracking', 'hooks', 'emit.js');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, '// the repo reports its sessions through this script\n');
  const settings = path.join(repo, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  const command = 'node "$CLAUDE_PROJECT_DIR/scripts/tracking/hooks/emit.js" || true';
  const hook = { hooks: [{ type: 'command', command }] };
  const before = JSON.stringify({ hooks: { SessionStart: [hook], Stop: [hook] } }, null, 2) + '\n';
  fs.writeFileSync(settings, before);
  const out = run(['install-hooks', '--repo', repo]);
  expect(out.status).toBe(0);
  expect(out.stdout).toContain('running scripts/tracking/hooks/emit.js: nothing changed');
  expect(fs.readFileSync(settings, 'utf8')).toBe(before);
});

test('install-hooks in the Flowwatch repo itself runs its own hooks/ folder', () => {
  const repo = tmp('fw-bin-self-');
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'flowwatch' }));
  expect(run(['install-hooks', '--repo', repo]).status).toBe(0);
  const settings = JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8'));
  const commands = Object.values(settings.hooks)
    .flat()
    .flatMap((e) => e.hooks.map((h) => h.command));
  for (const c of commands) expect(c).toBe('node "$CLAUDE_PROJECT_DIR/hooks/emit.js" || true');
  expect(settings.statusLine.command).toBe('node hooks/statusline.js');
});
