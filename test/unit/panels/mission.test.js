const path = require('path');
const { buildMissionControl } = require('../../../server/panels/mission');
const { missionOf } = require('../../../server/repo/missionFile');

// The milestones are the repo's own, from its MISSION.md: here a made-up repo's.
const mission = missionOf(path.join(__dirname, '..', '..', 'fixtures', 'repo'));

const deps = {
  specs: {
    capabilities: {
      'checkout-flow': { implemented: 8, known_broken: 0, aspirational: 13, not_applicable: 0, total: 21 },
    },
    totals: { implemented: 176, known_broken: 53, aspirational: 124, not_applicable: 2, total: 355 },
  },
  changes: { active: [{ topic: 't', lane: 'other', status: 'draft' }], byLane: { other: 1 }, archivedCount: 15 },
  velocity: { totalPRs: 30, perWeek: { '2026-W27': 30 } },
  config: { focus: mission.focus, milestones: mission.milestones },
};

test('assembles specs + changes + velocity + milestones into one payload', () => {
  const mc = buildMissionControl(deps);
  expect(mc.totals.total).toBe(355);
  expect(mc.activeChanges).toBe(1);
  expect(mc.archivedChanges).toBe(15);
  expect(mc.milestones.find((m) => m.id === 'guest-checkout-live')).toBeTruthy();
  // milestone rolls up its specs' implemented/total
  const cm = mc.milestones.find((m) => m.id === 'guest-checkout-live');
  expect(cm.specImplemented).toBe(8);
  expect(cm.specTotal).toBe(21);
});

// ─── a milestone with no workstream must not borrow another's stage ───
// Mapped to a workstream it has nothing to do with, a milestone would show that workstream's stage. A
// milestone that is not about a workstream has no frontier, and inventing one asserts something false on the page.

const { buildMissionControl: build } = require('../../../server/panels/mission');

const STAGES = { format: 1, stages: ['idea', 'design', 'build', 'trial', 'live'] };
function parts({ milestones, caps = {}, workstreams = [], stages = STAGES }) {
  return {
    specs: { capabilities: caps, totals: {} },
    changes: { active: [], byLane: {}, archivedCount: 0 },
    velocity: { totalPRs: 0, perWeek: {} },
    config: { focus: 'f', milestones },
    stages: stages && { ...stages, workstreams },
  };
}
const ws = (id, cells) => ({ id, name: id, cells });

test('an infrastructure milestone (no workstreams) derives status from spec completion', () => {
  const out = build(
    parts({
      milestones: [{ id: 'status-page', title: 'Status page', specs: ['uptime-monitor'] }],
      caps: { 'uptime-monitor': { implemented: 4, total: 6 } },
      workstreams: [ws('guest-checkout', ['passed', 'passed', 'passed', 'passed', 'frontier'])],
    })
  );
  expect(out.milestones[0].frontier).toBeNull();
  expect(out.milestones[0].status).toBe('building'); // NOT the workstream's 'live', NOT 'stalled'
});

test('a milestone with no implemented scenarios reads scoped, not stalled', () => {
  const out = build(
    parts({
      milestones: [{ id: 'x', title: 'X', specs: ['order-emails'] }],
      caps: { 'order-emails': { implemented: 0, total: 4 } },
    })
  );
  expect(out.milestones[0].status).toBe('scoped');
});

test('a fully-implemented spec set reads specs-complete', () => {
  const out = build(
    parts({
      milestones: [{ id: 'g', title: 'G', specs: ['cart-totals'] }],
      caps: { 'cart-totals': { implemented: 16, total: 16 } },
    })
  );
  expect(out.milestones[0].status).toBe('specs-complete');
});

test('a workstream-backed milestone derives from the frontier, which wins over specs, labelled by the feed', () => {
  const milestones = [{ id: 'gc', title: 'Guest checkout', specs: ['checkout-flow'], workstreams: ['guest-checkout'] }];
  const caps = { 'checkout-flow': { implemented: 24, total: 89 } }; // spec-wise this is only 'building'
  const workstreams = [ws('guest-checkout', ['passed', 'inferred', 'passed', 'frontier', 'none'])];
  const named = build(parts({ milestones, caps, workstreams }));
  expect(named.milestones[0].frontier).toBe(4);
  expect(named.milestones[0].status).toBe('trial'); // no milestoneStatus: the stage's own name
  const labelled = build(
    parts({
      milestones,
      caps,
      workstreams,
      stages: { ...STAGES, milestoneStatus: ['proposed', 'designed', 'building', 'in trial', 'live'] },
    })
  );
  expect(labelled.milestones[0].status).toBe('in trial');
  expect(labelled.milestones[0].eta).toBeUndefined();
});

test('a milestone over several workstreams follows the furthest one', () => {
  const out = build(
    parts({
      milestones: [{ id: 'm', title: 'M', specs: [], workstreams: ['a', 'b', 'missing'] }],
      workstreams: [
        ws('a', ['passed', 'frontier', 'none', 'none', 'none']),
        ws('b', ['passed', 'passed', 'passed', 'failed', 'none']), // no frontier cell: its furthest passed stage
        ws('c', ['passed', 'passed', 'passed', 'passed', 'frontier']),
      ], // not named: never counted
    })
  );
  expect(out.milestones[0].frontier).toBe(3);
  expect(out.milestones[0].status).toBe('build');
});

test('a named workstream that has reached no stage does not fabricate a frontier', () => {
  const out = build(
    parts({
      milestones: [{ id: 'p', title: 'P', specs: ['saved-cards'], workstreams: ['saved-cards'] }],
      caps: { 'saved-cards': { implemented: 2, total: 15 } },
      workstreams: [ws('saved-cards', ['skipped', 'none', 'none', 'none', 'none'])],
    })
  );
  expect(out.milestones[0].frontier).toBeNull();
  expect(out.milestones[0].status).toBe('building'); // from specs — 'stalled' was a human judgement
});

test("the stages payload carries each workstream's frontier and the feed's warnings, never the format number", () => {
  const out = build(parts({ milestones: [], workstreams: [ws('a', ['passed', 'frontier', 'none', 'none', 'none'])] }));
  expect(out.stages).toEqual({
    stages: STAGES.stages,
    milestoneStatus: null,
    warnings: [],
    workstreams: [
      { id: 'a', name: 'a', role: null, cells: ['passed', 'frontier', 'none', 'none', 'none'], frontier: 2 },
    ],
  });
  expect(build(parts({ milestones: [], stages: null })).stages).toBeNull();
});
