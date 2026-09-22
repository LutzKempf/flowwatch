const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { panelState } = require('./setup/setupRules');

const TIMEOUT_MS = 10_000;
const MAX_OUTPUT = 5 * 1024 * 1024;
const FORMAT = 1;

/** @typedef {{config: Record<string, any>|null, error: string|null, unreadable?: boolean}} Wiring readWiring's result */
/**
 * @typedef {{state: 'not-set-up'|'off'|'error'|'data', reason?: string, command?: string[], file?: string,
 *   detail?: string}} FeedSource `reason` with 'error'; `detail` and a command or a file with 'data'
 */
/** @typedef {{state: 'not-set-up'|'off'|'error'|'data', reason?: string, data?: any}} FeedResult */

/**
 * Reads one repo-fed panel: the command or file its flowwatch.json entry names, parsed, and checked against
 * the panel's format. Never throws and never blocks the collector: every way it can fail is a state the
 * panel shows with its reason, so a broken feed never reads as "nothing to report".
 * @param {string} repoRoot the repo the command runs in and the file is read from
 * @param {Wiring} wiring readWiring's result
 * @param {string} key the panel's key in flowwatch.json
 * @param {(data: any) => string[]} check the panel's format check: the problems it finds, [] for none
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<FeedResult>} `data` with 'data', `reason` with 'error'
 */
async function readFeed(repoRoot, wiring, key, check, { timeoutMs = TIMEOUT_MS } = {}) {
  const source = feedSource(repoRoot, wiring, key);
  if (source.state !== 'data') return source;

  let text;
  try {
    text = source.command
      ? await run(source.command, repoRoot, timeoutMs)
      : await readFile(repoRoot, /** @type {string} */ (source.file));
  } catch (e) {
    return { state: 'error', reason: key + ': ' + /** @type {Error} */ (e).message };
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return {
      state: 'error',
      reason:
        key +
        ': ' +
        (source.command ? 'its command printed' : source.file + ' is') +
        ' not JSON (' +
        /** @type {Error} */ (e).message +
        ')',
    };
  }
  if (!data || data.format !== FORMAT) {
    const given = data && data.format !== undefined ? 'format ' + JSON.stringify(data.format) : 'no format';
    return { state: 'error', reason: key + ' gives ' + given + '; this Flowwatch reads format ' + FORMAT };
  }
  const problems = check(data);
  if (problems.length) {
    const more = problems.length > 3 ? ' (and ' + (problems.length - 3) + ' more)' : '';
    return { state: 'error', reason: key + ' does not match its format: ' + problems.slice(0, 3).join('; ') + more };
  }
  return { state: 'data', data };
}

/**
 * What a panel's flowwatch.json entry says, without running or reading anything: the setup check uses this,
 * the page runs the feed. A file that is not there is already an error here.
 * @param {string} repoRoot
 * @param {Wiring} wiring readWiring's result
 * @param {string} key the panel's key in flowwatch.json
 * @returns {FeedSource} `detail` says in words where the panel's data comes from
 */
function feedSource(repoRoot, wiring, key) {
  if (wiring.unreadable) return { state: 'error', reason: 'flowwatch.json could not be read: ' + wiring.error };
  const base = panelState({ config: wiring.config, configError: wiring.error, key });
  if (base.state !== 'data') return base;

  // A 'data' state means the file is there and names the panel.
  const entry = /** @type {Record<string, any>} */ (wiring.config)[key];
  const hasCommand =
    Array.isArray(entry && entry.command) &&
    entry.command.length > 0 &&
    entry.command.every((/** @type {unknown} */ a) => typeof a === 'string' && a !== '');
  const hasFile = typeof (entry && entry.file) === 'string' && entry.file.trim() !== '';
  if (hasCommand === hasFile) {
    return {
      state: 'error',
      reason:
        key +
        ' needs either "command" (a list such as ["node", "scripts/' +
        key +
        '.js"], run without a shell) or "file" (a path in the repo)',
    };
  }
  if (hasCommand) return { state: 'data', command: entry.command, detail: 'runs ' + entry.command.join(' ') };
  if (!fs.existsSync(path.resolve(repoRoot, entry.file))) {
    return { state: 'error', reason: key + ': names ' + entry.file + ', which is not there' };
  }
  return { state: 'data', file: entry.file, detail: 'reads ' + entry.file };
}

/**
 * Runs a feed's command with the repo as its working folder and its arguments passed as they are: no shell
 * ever reads them. "node" means the Node running Flowwatch.
 * @param {string[]} argv
 * @param {string} cwd
 * @param {number} timeoutMs
 * @returns {Promise<string>} what it printed
 */
function run(argv, cwd, timeoutMs) {
  const [bin, ...args] = argv;
  return new Promise((resolve, reject) => {
    execFile(
      bin === 'node' ? process.execPath : bin,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: MAX_OUTPUT, windowsHide: true, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout);
        if (err.killed)
          return reject(new Error('its command ran longer than ' + timeoutMs / 1000 + ' s and was stopped'));
        if (typeof err.code !== 'number') return reject(new Error('its command could not start (' + err.message + ')'));
        const first = String(stderr || '')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find(Boolean);
        reject(new Error('its command exited with code ' + err.code + (first ? ': ' + first.slice(0, 200) : '')));
      }
    );
  });
}

/**
 * @param {string} repoRoot
 * @param {string} rel the feed file, relative to the repo
 * @returns {Promise<string>}
 */
async function readFile(repoRoot, rel) {
  try {
    return await fs.promises.readFile(path.resolve(repoRoot, rel), 'utf8');
  } catch (e) {
    const err = /** @type {NodeJS.ErrnoException} */ (e);
    throw new Error(
      err.code === 'ENOENT'
        ? 'names ' + rel + ', which is not there'
        : rel + ' could not be read (' + err.message + ')',
      { cause: e }
    );
  }
}

module.exports = { readFeed, feedSource, TIMEOUT_MS };
