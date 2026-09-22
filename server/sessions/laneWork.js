const { capabilityLane } = require('./capabilityLane');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {{specs: object[], stories: Array<Record<string, any>>, older_stories: number,
 *   older: Array<Record<string, any>>}} LaneWork a lane's specs, its stories in flight and the older ones
 */

/**
 * The newest commit time per active change folder, from one `git log --format=%x00%ct --name-only`
 * over openspec/changes. Newest commits come first, so the first time seen per folder wins.
 * @param {string} text git log output
 * @returns {Map<string, number>} topic -> epoch ms
 */
function storyTouchTimes(text) {
  const times = new Map();
  let at = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (line.startsWith('\u0000')) {
      at = Number(line.slice(1)) * 1000;
      continue;
    }
    const m = line.match(/^openspec\/changes\/([^/]+)\//);
    if (!m || m[1] === 'archive' || !Number.isFinite(at)) continue;
    if (!times.has(m[1])) times.set(m[1], at);
  }
  return times;
}

/**
 * Specs and stories, by lane.
 *
 * A capability takes its lane from the category MISSION.md says owns it, then inference (capabilityLane). A
 * story sits under every spec it has a delta for, in each of those specs' lanes — so a change touching a flow
 * and its reporting shows on both cards. A story with no delta goes under "Other in flight" (`under: []`) of
 * the lane its topic names, or "No category". Stories untouched for more than `freshDays`, or with no
 * known touch, go in `older` instead: the card counts them (it is for what is in flight), and Cleanup,
 * where old stories are closed, lists them.
 *
 * @param {{capabilities: Object<string, {implemented:number,total:number}>,
 *   stories: Array<{topic:string, status:string, capabilities:string[], touched_at:number|null}>,
 *   table: ReturnType<typeof import('./capabilityLane').ownerTable>, inferCategory: (s: string) => string|null,
 *   now: number, freshDays?: number}} input
 * @returns {Map<string|null, LaneWork>}
 */
function placeWork({ capabilities = {}, stories = [], table, inferCategory, now, freshDays = 14 }) {
  /** @type {Map<string|null, LaneWork>} */
  const lanes = new Map();
  const laneFor = (/** @type {string|null} */ name) => {
    if (!lanes.has(name)) lanes.set(name, { specs: [], stories: [], older_stories: 0, older: [] });
    return /** @type {LaneWork} */ (lanes.get(name));
  };
  const capLane = new Map();
  for (const [capability, c] of Object.entries(capabilities)) {
    const { lane, from } = capabilityLane(capability, { table, inferCategory });
    capLane.set(capability, lane);
    laneFor(lane).specs.push({ capability, implemented: c.implemented, total: c.total, lane_from: from });
  }
  for (const s of stories) {
    const fresh = s.touched_at != null && now - s.touched_at <= freshDays * DAY_MS;
    const byLane = new Map();
    for (const cap of s.capabilities || []) {
      const lane = capLane.has(cap) ? capLane.get(cap) : capabilityLane(cap, { table, inferCategory }).lane;
      if (!byLane.has(lane)) byLane.set(lane, []);
      byLane.get(lane).push(cap);
    }
    if (!byLane.size) {
      let inferred;
      try {
        inferred = inferCategory(s.topic);
      } catch {
        inferred = null;
      }
      byLane.set(inferred || null, []);
    }
    for (const [lane, under] of byLane) {
      const entry = laneFor(lane);
      const row = {
        topic: s.topic,
        status: s.status,
        capabilities: s.capabilities || [],
        under,
        days_since_touched: s.touched_at == null ? null : Math.floor((now - s.touched_at) / DAY_MS),
      };
      if (fresh) entry.stories.push(row);
      else {
        entry.older.push(row);
        entry.older_stories += 1;
      }
    }
  }
  for (const entry of lanes.values()) entry.stories.sort((a, b) => a.days_since_touched - b.days_since_touched);
  return lanes;
}

module.exports = { placeWork, storyTouchTimes };
