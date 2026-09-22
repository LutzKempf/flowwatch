const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { collectorConfig, dataDirFor } = require('./collectorConfig');

const FALLBACK_PORT = 4477;

// The repo's own collector, when its flowwatch.json names one ("collector": port, dataDir) — read
// once per hook process. Without it, the shared defaults below.
const REPO = collectorConfig(process.env.CLAUDE_PROJECT_DIR);

/**
 * Collector port for the fire-and-forget POST. Reads FLOWWATCH_PORT the way server/server.js
 * does: a set-but-empty var or garbage is treated as unset. Unlike the server, 0 (ephemeral) is meaningless for a
 * CLIENT that must dial a concrete port, so anything < 1 falls back too.
 * @returns {number} port to dial (explicit env value, else the repo's collector port, else 4477)
 */
function envPort() {
  const fallback = REPO.port || FALLBACK_PORT;
  const raw = process.env.FLOWWATCH_PORT;
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

// Where this repo's events are appended: the logs folder the repo's collector replays at boot.
const LOG_DIR = path.join(dataDirFor(process.env.CLAUDE_PROJECT_DIR), 'logs');

/**
 * Stamps a partial event with a fresh id + ts.
 * @param {Record<string, any>} fields partial event (session_id, worktree, type, ...)
 * @returns {Record<string, any>} full event ready for emit()
 */
function buildEvent(fields) {
  return { id: crypto.randomUUID(), ts: Date.now(), ...fields };
}

/**
 * Ingest contract preflight (the checks of server/ingest.js assertValidEvent, minus id —
 * buildEvent stamps that): non-empty session_id, finite ts, non-empty type.
 * @param {Record<string, any>} ev candidate event
 * @returns {boolean} true if the collector would accept it
 */
function isIngestable(ev) {
  return (
    !!ev &&
    typeof ev.session_id === 'string' &&
    ev.session_id.length > 0 &&
    Number.isFinite(ev.ts) &&
    typeof ev.type === 'string' &&
    ev.type.length > 0
  );
}

/**
 * Quarantines a contract-failing event to <logDir>/rejected.jsonl — visible and
 * diagnosable, but never in the main log (boot-replay would just error on it)
 * and never POSTed (the collector would 400 it).
 * @param {Record<string, any>} ev the rejected event
 * @param {{logDir?: string}} [opts]
 */
function appendRejected(ev, { logDir = LOG_DIR } = {}) {
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(path.join(logDir, 'rejected.jsonl'), JSON.stringify(ev) + '\n');
}

/**
 * Durably appends the event to the per-worktree log, so it survives the collector being down: the
 * collector replays these logs when it starts.
 * @param {Record<string, any>} ev full event
 * @param {{logDir?: string}} [opts]
 */
function appendEvent(ev, { logDir = LOG_DIR } = {}) {
  fs.mkdirSync(logDir, { recursive: true });
  const wt = (ev.worktree || 'unknown').replace(/[^\w.-]/g, '_');
  fs.appendFileSync(path.join(logDir, `${wt}.log.jsonl`), JSON.stringify(ev) + '\n');
}

/**
 * Fire-and-forget POST to the local collector; never throws, never blocks the session.
 * @param {Record<string, any>} ev full event
 * @param {{port?: number}} [opts]
 */
function postEvent(ev, { port = envPort() } = {}) {
  try {
    const req = require('http').request(
      {
        host: '127.0.0.1',
        port,
        path: '/events',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        timeout: 500,
      },
      (res) => res.resume()
    );
    req.on('error', () => {});
    req.on('timeout', () => req.destroy());
    req.end(JSON.stringify(ev));
  } catch {
    /* collector down — append-log has it */
  }
}

/**
 * Emits one event: append-log + POST for ingestable events; rejected.jsonl
 * quarantine (no append, no POST) for contract-failing ones. Never throws.
 * @param {Record<string, any>} ev full event (from buildEvent)
 * @param {{logDir?: string, port?: number}} [opts]
 */
function emit(ev, opts) {
  if (!isIngestable(ev)) {
    appendRejected(ev, opts);
    return;
  }
  appendEvent(ev, opts);
  postEvent(ev, opts);
}

module.exports = { buildEvent, appendEvent, postEvent, emit, envPort, isIngestable, LOG_DIR };
