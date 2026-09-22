const { stagesPayload } = require('./stages');
const { ideasPayload } = require('./ideas');

/**
 * Spec completion → milestone status, for a milestone no workstream's frontier covers.
 *
 * Not every milestone is a workstream walking the repo's stages: a hosting change or a
 * process rule has no frontier, and the two tempting answers are both dishonest —
 * borrowing some workstream's frontier claims a stage the milestone never walked, so a
 * milestone that is only scoped reads as nearly done, while defaulting to 'stalled'
 * states a human judgement about momentum that no file records.
 *
 * Scenario counts are a fact, so the status is derived from those instead, and
 * the rail prints the count beside it so the evidence is visible.
 * @param {number} implemented
 * @param {number} total
 * @returns {'no-specs'|'scoped'|'building'|'specs-complete'}
 */
function statusForSpecs(implemented, total) {
  if (total === 0) return 'no-specs';
  if (implemented === 0) return 'scoped';
  return implemented >= total ? 'specs-complete' : 'building';
}

/**
 * Assembles the /api/mission payload from the three parsers, the repo's feeds and its MISSION.md.
 * @param {{specs: {capabilities: Object<string, {implemented: number, total: number}>, totals: object},
 *          changes: {active: object[], byLane: object, archivedCount: number},
 *          velocity: {totalPRs: number, perWeek: object},
 *          config: {focus: string|null, milestones: Array<{id: string, specs: string[], workstreams?: string[],
 *            eta?: unknown, status?: unknown}>},
 *          value?: {figures: Array<{text: string, tone?: string}>}|null,
 *          stages?: import('./stages').StagesFeed|null, ideas?: import('./ideas').IdeasFeed|null,
 *          mission?: object|null, sources?: object|null, panels?: object|null}} parts `stages` and `ideas`
 *   are those feeds as checked
 * @returns {Record<string, any>} dashboard payload (milestones gain specImplemented/specTotal/frontier/status, the
 *   status taken from the furthest workstream the milestone names, labelled by the feed — never read from
 *   config — or, with none, from its specs)
 */
function buildMissionControl({
  specs,
  changes,
  velocity,
  config,
  value = null,
  stages = null,
  ideas = null,
  mission = null,
  sources = null,
  panels = null,
}) {
  const board = stagesPayload(stages);
  const milestones = config.milestones.map((m) => {
    let implemented = 0,
      total = 0;
    for (const cap of m.specs) {
      const c = specs.capabilities[cap];
      if (c) {
        implemented += c.implemented;
        total += c.total;
      }
    }
    const frontiers = /** @type {number[]} */ (
      (m.workstreams || [])
        .map((id) => (board && board.workstreams.find((w) => w.id === id))?.frontier)
        .filter(Number.isInteger)
    );
    const { eta, status, ...rest } = m; // eta and status are dropped on purpose
    const frontier = frontiers.length ? Math.max(...frontiers) : null;
    // A frontier comes from the board, so the labels are there whenever there is a frontier.
    const labels = board ? board.milestoneStatus || board.stages : [];
    return {
      ...rest,
      specImplemented: implemented,
      specTotal: total,
      frontier,
      status: frontier === null ? statusForSpecs(implemented, total) : labels[frontier - 1],
    };
  });
  return {
    mission,
    sources,
    panels,
    focus: config.focus,
    totals: specs.totals,
    capabilities: specs.capabilities,
    activeChanges: changes.active.length,
    archivedChanges: changes.archivedCount,
    changesByLane: changes.byLane,
    velocity,
    milestones,
    value,
    stages: board,
    ideas: ideasPayload(ideas),
  };
}

module.exports = { buildMissionControl };
