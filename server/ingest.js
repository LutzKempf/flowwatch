const { detectPhase } = require('./sessions/phaseDetector');
const { rollup, ROLLUP_VERSION } = require('./metricsRollup');
const { PHASE_COUNT } = require('./sessions/phases');
const { stateForEvents } = require('./sessionState');

/** @param {unknown} v */
function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

/** @param {Record<string, any>} ev a candidate event; throws when the collector would refuse it */
function assertValidEvent(ev) {
  if (!ev || !isNonEmptyString(ev.id) || !isNonEmptyString(ev.session_id)) {
    throw new Error('event needs non-empty string id and session_id');
  }
  if (!Number.isFinite(ev.ts)) throw new Error('event needs a finite numeric ts');
  if (!isNonEmptyString(ev.type)) throw new Error('event needs a non-empty string type');
}

/**
 * Validates and ingests one telemetry event, then recomputes the session's
 * phase + per-phase stats. Idempotent by event id.
 * @param {import('better-sqlite3').Database} db open pipeline db
 * @param {{id:string, session_id:string, ts:number, type:string, worktree?: string}} ev the event
 * @returns {boolean} true if newly ingested, false if a duplicate id (no-op)
 */
function ingestEvent(db, ev) {
  assertValidEvent(ev);

  const existed = db.prepare('SELECT 1 FROM events WHERE id=?').get(ev.id);
  if (existed) return false; // idempotent

  // One transaction: a mid-recompute throw must roll back the event row too,
  // or the id-dedupe above would block every retry of this event forever.
  db.transaction(() => {
    db.prepare('INSERT INTO events (id, session_id, ts, type, payload) VALUES (?,?,?,?,?)').run(
      ev.id,
      ev.session_id,
      ev.ts,
      ev.type,
      JSON.stringify(ev)
    );

    db.prepare(
      `INSERT INTO sessions (id, worktree, started_at, last_seen)
                VALUES (@sid, @wt, @ts, @ts)
                ON CONFLICT(id) DO UPDATE SET last_seen=@ts,
                  worktree=COALESCE(sessions.worktree, @wt)`
    ).run({ sid: ev.session_id, wt: ev.worktree || null, ts: ev.ts });

    recompute(db, ev.session_id);
  })();
  return true;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} sessionId
 */
function recompute(db, sessionId) {
  // rowid tiebreak: same-ts events replay in insertion order (stable, pinned).
  const rows = /** @type {Array<{payload: string}>} */ (
    db.prepare('SELECT payload FROM events WHERE session_id=? ORDER BY ts ASC, rowid ASC').all(sessionId)
  );
  const events = rows.map((r) => JSON.parse(r.payload));
  const phase = detectPhase(events);
  const stats = rollup(events);

  // `state` is written here, from the events alone: left at the schema default, every session would read
  // as working, including the ones waiting on you and the dead ones. Staleness and archiving stay derived
  // per request in buildPipeline().
  db.prepare('UPDATE sessions SET current_phase=?, state=? WHERE id=?').run(phase, stateForEvents(events), sessionId);
  const up = db.prepare(`INSERT INTO phase_stats (session_id, phase, work_ms, wait_ms, inputs, tokens_usd, tokens)
    VALUES (@s,@p,@w,@wa,@i,@t,@tk)
    ON CONFLICT(session_id,phase) DO UPDATE SET work_ms=@w, wait_ms=@wa, inputs=@i, tokens_usd=@t, tokens=@tk`);
  for (let p = 1; p <= PHASE_COUNT; p++) {
    const st = stats[p];
    up.run({ s: sessionId, p, w: st.work_ms, wa: st.wait_ms, i: st.inputs, t: st.tokens_usd, tk: st.tokens });
  }
}

/**
 * Redoes every session's stored roll-up when the rule that made them has changed since (ROLLUP_VERSION), and
 * records the version it used. Stored figures are otherwise redone only for a session that gets a new event, so a
 * finished session would show the old rule's numbers for good.
 * @param {import('better-sqlite3').Database} db
 * @returns {number} sessions redone (0 when the stored figures are already current)
 */
function refreshStoredStats(db) {
  const stored = db.prepare("SELECT value FROM meta WHERE key='rollup_version'").get();
  if (stored && Number(/** @type {{value: string}} */ (stored).value) === ROLLUP_VERSION) return 0;
  const ids = /** @type {Array<{id: string}>} */ (db.prepare('SELECT id FROM sessions').all());
  db.transaction(() => {
    for (const { id } of ids) recompute(db, id);
    db.prepare(
      "INSERT INTO meta (key, value) VALUES ('rollup_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
    ).run(String(ROLLUP_VERSION));
  })();
  return ids.length;
}

module.exports = { ingestEvent, refreshStoredStats };
