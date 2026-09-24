const Database = require('better-sqlite3');

/**
 * Opens (creating if needed) the pipeline SQLite db with WAL + schema.
 * @param {string} [path=':memory:'] db file path or ':memory:'
 * @returns {import('better-sqlite3').Database}
 */
function openDb(path = ':memory:') {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, worktree TEXT, milestone TEXT,
      origin TEXT DEFAULT 'live',            -- 'live' | 'backfill' (a backfilled session's data is partial)
      current_phase INTEGER DEFAULT 1, state TEXT DEFAULT 'working',
      started_at INTEGER, last_seen INTEGER
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, session_id TEXT, ts INTEGER, type TEXT, payload TEXT
    );
    CREATE INDEX IF NOT EXISTS events_session_ts ON events(session_id, ts);
    CREATE TABLE IF NOT EXISTS phase_stats (
      session_id TEXT, phase INTEGER,
      work_ms INTEGER DEFAULT 0, wait_ms INTEGER DEFAULT 0,
      inputs INTEGER DEFAULT 0,
      tokens_usd REAL DEFAULT 0,          -- live cost feed (statusLine)
      tokens INTEGER DEFAULT 0,           -- backfill token counts (transcript usage)
      entered INTEGER DEFAULT 0,          -- 1: the session was in this phase; 0 with a later phase: it skipped it
      PRIMARY KEY (session_id, phase)
    );
    CREATE TABLE IF NOT EXISTS meta (   -- one-time markers (backfill_done); schema owned HERE
      key TEXT PRIMARY KEY, value TEXT
    );
  `);
  // A database made before phase_stats had `entered`: add it. The stored figures are redone at the collector's
  // next start (ROLLUP_VERSION), which fills it in.
  const cols = /** @type {Array<{name: string}>} */ (db.prepare('PRAGMA table_info(phase_stats)').all());
  if (!cols.some((c) => c.name === 'entered')) db.exec('ALTER TABLE phase_stats ADD COLUMN entered INTEGER DEFAULT 0');
  return db;
}

module.exports = { openDb };
