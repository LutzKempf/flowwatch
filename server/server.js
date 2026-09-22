const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('./db');
const { createApp } = require('./collector');
const { ingestLogFile } = require('./appendLog');
const { scanOnce } = require('./repo/repoWatcher');
const { readWiring } = require('./repo/settings');
const { backfillDir, projectDirFilter } = require('./sessions/runBackfill');
const { canonicalRepoRoot } = require('./repo/repoRoot');
const { collectorConfig, dataDirFor } = require('../hooks/lib/collectorConfig');

/**
 * Robust env-port parse: honors an explicit 0 (ephemeral), but treats a set-but-EMPTY
 * var (common .env artifact — Number('')===0) or a non-numeric value as unset.
 * @returns {number|undefined}
 */
function envPort() {
  const raw = process.env.FLOWWATCH_PORT;
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

// Port-bind IS the single-instance guard: a second process on the same port gets EADDRINUSE.
/**
 * Boots the collector: opens the db, replays pending append-logs, binds localhost,
 * and polls the repo watcher (gate markers + verify evidence → phases 8/10).
 * @param {import('./collector').AppOptions & {port?: number, dbPath?: string, logDir?: string, watchMs?: number,
 *   backfillRoot?: string}} [opts] the collector app's options, plus:
 *   watchMs: poll interval (default 15000); 0 disables the watcher entirely.
 *   backfillRoot: Claude Code projects dir walked ONCE (meta.backfill_done marker)
 * @returns {Promise<{port:number, close:() => Promise<void>}>}
 */
function startServer(opts = {}) {
  // The repo this collector serves. The `flowwatch` command passes its git top level; a caller that
  // passes nothing gets the folder the process runs in.
  const repoRoot = opts.repoRoot || process.cwd();
  // A repo can give its collector its own port and data folder (flowwatch.json "collector"), which
  // its session hooks read too: a second repo on the box then never shares the first one's.
  // Precedence: an explicit option, then the env, then the repo's file, then the defaults.
  const own = collectorConfig(repoRoot);
  const {
    port = envPort() !== undefined ? envPort() : own.port || 4477,
    dbPath = path.join(dataDirFor(repoRoot), 'pipeline.db'),
  } = opts;
  return new Promise((resolve, reject) => {
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = openDb(dbPath);

    // Boot-time append-log replay: events appended while the collector
    // was down are ingested now; each replayed log rotates to <name>.replayed so the
    // next boot is O(new events), not O(total history).
    const logDir = opts.logDir || path.join(dataDirFor(repoRoot), 'logs');
    if (fs.existsSync(logDir)) {
      for (const f of fs.readdirSync(logDir).filter((f) => f.endsWith('.log.jsonl'))) {
        const full = path.join(logDir, f);
        // RENAME FIRST, then read: an append landing after the rename creates a
        // fresh .log.jsonl picked up next boot — no read-vs-rename loss window.
        // A rename failure (file busy) skips this file this boot; retried next boot.
        const rotated = full + '.replayed';
        let renamed = false;
        try {
          fs.renameSync(full, rotated); // rotate: next boot is O(new events)
          renamed = true;
          ingestLogFile(db, rotated); // idempotent — safe to replay
        } catch (e) {
          console.error('[flowwatch] replay failed for', f, /** @type {Error} */ (e).message);
          // If the rename succeeded but ingest threw, the events would be orphaned in a
          // .replayed file no boot re-scans — rename back so next boot retries (ingest is
          // idempotent, so a partial ingest before the throw is harmless).
          if (renamed) {
            try {
              fs.renameSync(rotated, full);
            } catch (e2) {
              console.error(
                '[flowwatch] could not restore',
                f,
                '- events parked in .replayed:',
                /** @type {Error} */ (e2).message
              );
            }
          }
        }
      }
    }

    // ONCE-ONLY transcript backfill: ~/.claude/projects is large
    // and hot — walking + recomputing it on EVERY boot is pure waste. A persisted marker
    // row makes the backfill genuinely one-time; delete the row (or the DB) to force a re-run.
    if (opts.backfillRoot) {
      const done = db.prepare("SELECT value FROM meta WHERE key='backfill_done'").get();
      if (!done) {
        try {
          // Only this repo's own transcripts (its canonical checkout and worktrees): ~/.claude/projects
          // holds every repo's, and a new repo's board must not import another's history.
          const n = backfillDir(db, opts.backfillRoot, { keepProject: projectDirFilter(canonicalRepoRoot(repoRoot)) });
          db.prepare("INSERT INTO meta (key, value) VALUES ('backfill_done', ?)").run(String(n));
          console.log(`[flowwatch] one-time backfill: ${n} events`);
        } catch (e) {
          console.error('[flowwatch] backfill failed:', /** @type {Error} */ (e).message);
        }
      }
    }

    // The Mission page's folders derive from repoRoot (set above): folders relative to the working
    // folder would fail whenever the collector was not started from the repo root.
    // Where Claude Code keeps its transcripts: a read-only input for /api/inbox, overridable so tests can point
    // it at a fixture tree. The desktop app's session records folder (per platform, or flowwatch.json
    // "sessions.appRecords") and the category inference ("sessions.categorize") are the collector's to resolve
    // from the repo's settings; a caller may inject either instead (appDir, inferCategory).
    const inbox = {
      projectsDir: path.join(os.homedir(), '.claude', 'projects'),
      // Not repoRoot as-is: a collector started inside a worktree would scope the inbox to that one
      // worktree and hide every other session on the box.
      repoRoot: canonicalRepoRoot(repoRoot),
      ...(opts.inbox || {}),
    };
    // The collector anchors every repo path to repoRoot and takes the optional panels' sources from the
    // repo's flowwatch.json. Only folders the caller named are passed: a default here would win
    // over the repo's own file.
    const app = createApp(db, {
      ...opts,
      repoRoot,
      inbox,
      repoDir: opts.repoDir || repoRoot,
    });
    // Localhost only — an unauthenticated collector must never bind 0.0.0.0.
    // try/catch: a synchronous listen() throw (e.g. invalid port value) must still
    // close the db before rejecting.
    /** @type {import('http').Server} */
    let server;
    try {
      server = app.listen(/** @type {number} */ (port), '127.0.0.1');
    } catch (e) {
      db.close();
      reject(e);
      return;
    }
    server.once('listening', () => {
      const actual = /** @type {import('net').AddressInfo} */ (server.address()).port;
      // Repo watcher poll: advances off-session phases (8 PR green, 10 verify) from the folders the repo's
      // "pipeline" settings name, read on every poll so an edit applies without a restart. watchMs:0 = off
      // (tests that don't want the poll).
      /** @type {NodeJS.Timeout|undefined} */
      let timer;
      if (opts.watchMs !== 0) {
        const ms = opts.watchMs || 15000;
        timer = setInterval(() => {
          try {
            const { config } = readWiring(repoRoot);
            scanOnce(db, { root: repoRoot, pipeline: config && config.pipeline });
          } catch {
            /* next poll retries */
          }
        }, ms);
        if (timer.unref) timer.unref();
      }
      resolve({
        port: actual,
        close: () =>
          new Promise((r) => {
            clearInterval(timer);
            server.close(() => {
              db.close();
              r();
            });
          }),
      });
    });
    server.once('error', (e) => {
      db.close();
      reject(e);
    });
  });
}

module.exports = { startServer, envPort };
