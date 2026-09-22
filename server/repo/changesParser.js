const fs = require('fs');
const path = require('path');
const { ownerTable, capabilityLane } = require('../sessions/capabilityLane');

/**
 * @param {string} dir a change folder
 * @returns {string} the status its proposal.md front matter gives, else 'proposed'
 */
function readStatus(dir) {
  try {
    const p = path.join(dir, 'proposal.md');
    const m = fs.readFileSync(p, 'utf8').match(/^---[\s\S]*?status:\s*([^\n]+)[\s\S]*?---/);
    return m ? m[1].trim() : 'proposed';
  } catch {
    return 'proposed';
  }
}

/**
 * The capabilities a change edits: its specs/<capability>.md deltas, by name.
 * @param {string} dir a change folder
 * @returns {string[]}
 */
function editedCapabilities(dir) {
  try {
    return fs
      .readdirSync(path.join(dir, 'specs'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.slice(0, -3))
      .sort();
  } catch {
    return [];
  }
}

/**
 * A change's lane: the category owning what it edits, by the same lookup as a spec's lane (the owners MISSION.md
 * names, exact before prefix, then the repo's inference). A change editing capabilities of several categories
 * is counted once, under the owner of the first capability by name that has one — the counts then add up to
 * the number of changes. One editing no capability with an owner, or none at all, is `other`.
 * @param {string[]} capabilities sorted by name
 * @param {{table: ReturnType<typeof ownerTable>, inferCategory: (capability: string) => string|null}} lookup
 * @returns {string}
 */
function laneOfChange(capabilities, lookup) {
  for (const capability of capabilities) {
    const { lane } = capabilityLane(capability, lookup);
    if (lane) return lane;
  }
  return 'other';
}

/**
 * Scans openspec/changes: active change folders (with lane, proposal status and the capabilities they edit)
 * and the archived count.
 * @param {string|null} changesDir openspec/changes directory (null: none)
 * @param {{table?: ReturnType<typeof ownerTable>, inferCategory?: (capability: string) => string|null}} [lookup] the owners
 *   (capabilityLane's ownerTable of MISSION.md's categories) and the repo's inference; without them, `other`
 * @returns {{active: Array<{topic: string, lane: string, status: string, capabilities: string[]}>,
 *            byLane: Object<string, number>, archivedCount: number, missing?: true}} a repo with no
 *   changes folder has no changes yet (`missing`), which is a state, not a failure
 */
function parseChanges(changesDir, { table = ownerTable({}), inferCategory = () => null } = {}) {
  if (!changesDir || !fs.existsSync(changesDir)) return { active: [], byLane: {}, archivedCount: 0, missing: true };
  const entries = fs.readdirSync(changesDir, { withFileTypes: true });
  const active = [];
  let archivedCount = 0;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === 'archive') {
      archivedCount = fs
        .readdirSync(path.join(changesDir, 'archive'), { withFileTypes: true })
        .filter((d) => d.isDirectory()).length;
      continue;
    }
    const dir = path.join(changesDir, e.name);
    const capabilities = editedCapabilities(dir);
    active.push({
      topic: e.name,
      lane: laneOfChange(capabilities, { table, inferCategory }),
      status: readStatus(dir),
      capabilities,
    });
  }
  /** @type {Object<string, number>} */
  const byLane = {};
  for (const a of active) byLane[a.lane] = (byLane[a.lane] || 0) + 1;
  return { active, byLane, archivedCount };
}

module.exports = { parseChanges };
