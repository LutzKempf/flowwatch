#!/usr/bin/env node
// flowwatch: start the dashboard, check a repo's setup, or install the session hooks — always for one
// named repo: the git repository it runs in, or the folder given with --repo. Or serve the demo, which needs no repo.
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { version } = require('../package.json');

const USAGE = `flowwatch ${version}: how work flows through a fleet of AI coding agents

Usage: flowwatch <command> [--repo <folder>]

Commands:
  start           Start the dashboard for the repo and print its address
  check           List what is set up and what is missing; exits 1 until the required parts are done
  install-hooks   Add the session-tracking hooks to the repo's .claude/settings.json
  demo            Serve the demo, a signed snapshot of the dashboards, at http://127.0.0.1:4478/flowwatch/

Options:
  --repo <folder>  The repo to watch (default: the git repository you are in)
  --data <folder>  demo: the signed snapshot to show (default: the package's demo/data)
  --port <n>       demo: the port to serve it on (default: 4478; 0 picks a free one)
  --version        Print the version
  --help           Print this help
`;

/**
 * The repo a command works on: --repo, else the top of the git repository the process runs in, else the
 * folder itself.
 * @param {string|undefined} given the --repo value
 * @returns {string} an absolute folder
 */
function repoOf(given) {
  if (given) return path.resolve(given);
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
    if (top) return path.resolve(top);
  } catch {
    /* not inside a git repository */
  }
  return process.cwd();
}

/** @param {string} message what was wrong, or '' for the usage alone */
function fail(message) {
  process.stderr.write((message ? 'flowwatch: ' + message + '\n\n' : '') + USAGE);
  process.exitCode = 1;
}

/** @param {string[]} argv the arguments after `flowwatch` */
async function main(argv) {
  if (argv.includes('--help')) return process.stdout.write(USAGE);
  if (argv.includes('--version')) return process.stdout.write(version + '\n');
  const [command, ...rest] = argv;
  const at = rest.indexOf('--repo');
  if (at >= 0 && !rest[at + 1]) return fail('--repo needs a folder');
  const repoRoot = repoOf(at >= 0 ? rest[at + 1] : undefined);

  if (command === 'start') {
    const { startServer } = require('../server/server');
    const backfillRoot = process.env.FLOWWATCH_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects');
    const s = await startServer({ repoRoot, backfillRoot });
    process.stdout.write('[flowwatch] watching ' + repoRoot + ': open http://127.0.0.1:' + s.port + '\n');
    return;
  }
  if (command === 'check') {
    process.exitCode = await require('../server/setup/cli').runCheck(repoRoot);
    return;
  }
  if (command === 'install-hooks') {
    const { runInstall, fragmentFor } = require('./install-hooks');
    const frag = fragmentFor(repoRoot);
    // A repo that already reports its sessions through a script of its own keeps it: a second set of hooks
    // beside it would count every event twice.
    const own = require('../server/setup/checkSetup').hooksOf(repoRoot);
    if (own.state === 'ok' && own.script && !JSON.stringify(frag).includes(own.script)) {
      process.stdout.write(`[flowwatch] the session hooks are ${own.detail}: nothing changed\n`);
      return;
    }
    runInstall(path.join(repoRoot, '.claude', 'settings.json'), { frag });
    return;
  }
  if (command === 'demo') {
    const valueOf = (/** @type {string} */ name) => {
      const i = rest.indexOf(name);
      return i < 0 ? undefined : rest[i + 1] || '';
    };
    const data = valueOf('--data');
    const port = valueOf('--port');
    if (data === '') return fail('--data needs a folder');
    if (port !== undefined && !/^\d{1,5}$/.test(port)) return fail('--port needs a number');
    const { serveDemo } = require('../demo/serve');
    const s = await serveDemo({
      dataDir: path.resolve(data || path.join(__dirname, '..', 'demo', 'data')),
      port: port === undefined ? 4478 : Number(port),
    });
    process.stdout.write('[flowwatch] demo: open ' + s.url + '\n');
    // Ctrl-C would skip exit handlers; exiting instead lets the demo remove its temp build.
    for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => process.exit(0));
    return;
  }
  return fail(command ? 'unknown command "' + command + '"' : '');
}

main(process.argv.slice(2)).catch((e) => {
  process.stderr.write('flowwatch: ' + e.message + '\n');
  process.exitCode = 1;
});
