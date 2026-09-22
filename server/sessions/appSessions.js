const fs = require('fs');
const path = require('path');

/** @type {(p: unknown) => string} */
const slash = (p) =>
  String(p || '')
    .replace(/\\/g, '/')
    .toLowerCase()
    .replace(/\/+$/, '');

/**
 * A record's activity time. The app writes it as epoch milliseconds in current versions and as an
 * ISO string in older ones, and both shapes sit in the same folder today — reading only one of them
 * dates every other record to 1970 and empties the inbox.
 * @param {number|string|undefined} v raw lastActivityAt
 * @returns {number} epoch ms, 0 when unreadable
 */
const activityAt = (v) =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' ? Date.parse(v) || 0 : 0;

/**
 * Whether a session's working directory is inside the repo. A bare prefix is not enough: a sibling
 * checkout named shop-2 starts with shop, and its sessions would leak into the inbox.
 * @param {string} cwd session working directory
 * @param {string} repoRoot repo the sessions must live in
 * @returns {boolean}
 */
function insideRepo(cwd, repoRoot) {
  const home = slash(cwd);
  const want = slash(repoRoot);
  return home === want || home.startsWith(want + '/');
}

/**
 * The Claude desktop app's session records for one repo: the newest record per transcript lineage,
 * skipping archived sessions and anything last active before `since` — which is what keeps the
 * caller from reading a transcript per long-dead session.
 *
 * Scheduled-task runs are kept: a routine run that handed the turn back sits in the app waiting for
 * someone to read and archive it, like any other session. Left out, a finished run would read on the
 * Sessions board as "working, not waiting on you".
 *
 * `readable` is false when the records root itself cannot be read (not there, permissioned out). An
 * empty list then means "cannot see", not "nothing waiting", and the caller must say so rather than
 * render an empty inbox. `found` is false when there is no root at all — no folder on this platform
 * (`dir` null) or none at that path — which the board says in its own words.
 *
 * `all` keeps archived sessions too: the lanes payload names every session on the board, so it needs
 * an archived session's title.
 * @param {{dir: string|null, repoRoot: string, since?: number, all?: boolean}} opts
 * @returns {{records: Array<Record<string, any>>, readable: boolean, found: boolean}}
 */
function readAppSessions({ dir, repoRoot, since = 0, all = false }) {
  if (!dir) return { records: [], readable: false, found: false };
  const newest = new Map();
  let readable = true;
  let found = true;
  /** @type {(d: string, top: boolean) => void} */
  const walk = (d, top) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      if (top) {
        const code = /** @type {NodeJS.ErrnoException} */ (e).code;
        readable = false;
        found = code !== 'ENOENT' && code !== 'ENOTDIR';
      }
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(p, false);
        continue;
      }
      if (!e.name.startsWith('local_') || !e.name.endsWith('.json')) continue;
      let rec;
      try {
        rec = JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch {
        continue;
      }
      if (!rec.cliSessionId) continue;
      if (!all && rec.isArchived) continue;
      if (!insideRepo(rec.originCwd || rec.cwd, repoRoot)) continue;
      const at = activityAt(rec.lastActivityAt);
      if (at < since) continue;
      const prev = newest.get(rec.cliSessionId);
      if (!prev || at > activityAt(prev.lastActivityAt)) newest.set(rec.cliSessionId, rec);
    }
  };
  walk(dir, true);
  return { records: [...newest.values()], readable, found };
}

module.exports = { readAppSessions, insideRepo, activityAt };
