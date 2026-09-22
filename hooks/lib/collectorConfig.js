const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveRepoPath } = require('./repoPath');

/**
 * Where a repo's own collector listens and keeps its data: the "collector" entry of its flowwatch.json
 * (the root, else docs/). Read by the session hooks and by the collector, so a second repo on a box that
 * already runs Flowwatch never posts to, or logs into, the first one's. Absent, unusable or unreadable
 * gives null for each, and the callers keep their defaults (:4477 and ~/.flowwatch). Never throws: the
 * hooks run on every tool call of every session.
 * @param {string|undefined} projectDir the repo root ($CLAUDE_PROJECT_DIR in a hook)
 * @returns {{port: number|null, dataDir: string|null}} dataDir is absolute
 */
function collectorConfig(projectDir) {
  /** @type {{port: number|null, dataDir: string|null}} */
  const out = { port: null, dataDir: null };
  if (!projectDir) return out;
  for (const rel of ['flowwatch.json', path.join('docs', 'flowwatch.json')]) {
    let text;
    try {
      text = fs.readFileSync(path.join(projectDir, rel), 'utf8');
    } catch {
      continue;
    }
    try {
      const c = (JSON.parse(text) || {}).collector || {};
      if (Number.isInteger(c.port) && c.port > 0) out.port = c.port;
      if (typeof c.dataDir === 'string' && c.dataDir.trim()) out.dataDir = resolveRepoPath(projectDir, c.dataDir);
    } catch {
      /* an invalid file is the setup check's to report; the defaults stand */
    }
    return out;
  }
  return out;
}

/**
 * The folder holding a repo's Flowwatch database and event logs: FLOWWATCH_DATA_DIR when set, else the
 * repo's own ("collector.dataDir" in its flowwatch.json), else ~/.flowwatch. The collector and the hooks
 * both ask here, so the logs the hooks append are the logs the collector replays.
 * @param {string|undefined} projectDir the repo root
 * @returns {string} an absolute folder
 */
function dataDirFor(projectDir) {
  const env = process.env.FLOWWATCH_DATA_DIR;
  if (env && env.trim()) return path.resolve(env);
  return collectorConfig(projectDir).dataDir || path.join(os.homedir(), '.flowwatch');
}

module.exports = { collectorConfig, dataDirFor };
