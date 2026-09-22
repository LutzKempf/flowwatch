const fs = require('fs');
const { ingestEvent } = require('./ingest');

// Reads a JSONL log, ingesting each valid event. Idempotent (ingest dedupes by id),
// so replaying the whole file after a collector restart is safe.
/**
 * @param {import('better-sqlite3').Database} db open pipeline db
 * @param {string} filePath JSONL append-log path
 * @returns {number} count of newly ingested (non-duplicate, valid) events
 */
function ingestLogFile(db, filePath) {
  if (!fs.existsSync(filePath)) return 0;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  let ingested = 0;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    let ev;
    try {
      ev = JSON.parse(t);
    } catch {
      continue; // skip a corrupt line
    }
    try {
      if (ingestEvent(db, ev)) ingested++;
    } catch {
      /* skip invalid */
    }
  }
  return ingested;
}

module.exports = { ingestLogFile };
