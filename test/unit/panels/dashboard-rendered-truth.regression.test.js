// Pins on what the operator actually sees. In each case below the producer can be tested and
// correct while the rendered page is wrong, so each pin asserts the consumed value, not a proxy.
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', '..', '..', 'web');
const vm = require('vm');
const { CELL_STATES } = require('../../../server/panels/stages');
const { buildMissionControl } = require('../../../server/panels/mission');
const { velocityFromLog } = require('../../../server/repo/gitVelocity');

// ── 1. a cell state with no rule renders as a grey box ───────────────────────
// The stages grid writes each cell's state straight into class=, so a rule under any other name
// (.c.pass for passed) leaves the cell uncoloured — while the legend, whose swatches are drawn
// separately, still advertises a coloured board.
describe('every stages cell state a feed can give is styled', () => {
  // the Mission page's own stylesheet
  const css = fs.readFileSync(path.join(PUBLIC, 'pages', 'mission', 'page.css'), 'utf8');
  // derived from the format's own list, so a new state cannot be added without either styling it or
  // failing here
  const VISIBLE = CELL_STATES.filter((s) => s !== 'none'); // 'none' is the unstyled base cell

  test('the format has the six visible states this page must colour', () => {
    expect([...VISIBLE].sort()).toEqual(['failed', 'frontier', 'inferred', 'passed', 'skipped', 'voided']);
  });

  test.each(VISIBLE)('.c.%s has a CSS rule', (state) => {
    expect(css).toContain('.c.' + state + ' {');
  });

  test('the legend the grid draws has a styled swatch for every state in the feed, and only those', () => {
    const els = {
      'lc-grid': { innerHTML: '', style: {} },
      'lc-warn': { innerHTML: '' },
      'lc-legend': { innerHTML: '', hidden: true },
    };
    const sandbox = { document: { getElementById: (id) => els[id] || null } };
    vm.createContext(sandbox);
    vm.runInContext(
      fs.readFileSync(path.join(PUBLIC, 'lib', 'render.js'), 'utf8') + '\n;this.__rs = renderStages;',
      sandbox
    );
    sandbox.__rs(
      {
        stages: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        warnings: [],
        workstreams: [{ id: 'w', name: 'W', cells: CELL_STATES, frontier: 3 }],
      },
      { state: 'data' }
    );
    for (const state of CELL_STATES) {
      expect(els['lc-legend'].innerHTML).toContain('class="sw ' + state + '"');
      expect(css).toContain('.sw.' + state + ' {');
    }
    sandbox.__rs(
      { stages: ['a'], warnings: [], workstreams: [{ id: 'w', name: 'W', cells: ['passed'], frontier: 1 }] },
      { state: 'data' }
    );
    expect(els['lc-legend'].innerHTML.match(/class="sw /g)).toHaveLength(1);
  });
});

// ── 2. a milestone with no workstream claims no stage ─────────────────────────
// A milestone that never walked a workstream's stages has no frontier, and borrowing one asserts a
// stage it never reached.
describe("a milestone with no workstream does not borrow another one's stage", () => {
  const parts = (milestones, caps) => ({
    specs: { capabilities: caps, totals: {} },
    changes: { active: [], byLane: {}, archivedCount: 0 },
    velocity: { totalPRs: 0, perWeek: {}, trailing7d: 0 },
    config: { focus: 'f', milestones },
    stages: {
      format: 1,
      stages: ['idea', 'build', 'live'],
      milestoneStatus: ['proposed', 'building', 'live'],
      workstreams: [{ id: 'guest-checkout', name: 'Guest checkout', cells: ['passed', 'passed', 'frontier'] }],
    },
  });

  test('an infrastructure milestone derives from scenario completion', () => {
    const out = buildMissionControl(
      parts([{ id: 'status-page', title: 'Status page', specs: ['uptime-monitor'], workstreams: [] }], {
        'uptime-monitor': { implemented: 4, total: 6 },
      })
    );
    expect(out.milestones[0].frontier).toBeNull();
    expect(out.milestones[0].status).toBe('building');
  });

  test('a workstream-backed milestone still derives from its frontier', () => {
    const out = buildMissionControl(parts([{ id: 'gc', title: 'GC', specs: [], workstreams: ['guest-checkout'] }], {}));
    expect(out.milestones[0].status).toBe('live');
  });
});

// ── 3. velocity over a whole window ───────────────────────────────────────────
// perWeek's newest bucket is a PARTIAL ISO week for six days out of seven, so a
// tile reading it as the rate understates it.
describe('velocity is reported over a whole window, not a partial ISO week', () => {
  const lines = [
    '2026-09-08\tfeat: a (#90)',
    '2026-09-07\tfeat: b (#91)',
    '2026-09-05\tfeat: c (#92)',
    '2026-09-03\tfeat: d (#93)',
    '2026-08-20\tfeat: e (#94)',
  ];

  test('trailing7d spans seven days, not the current calendar bucket', () => {
    const v = velocityFromLog(lines, '2026-09-08');
    expect(v.trailing7d).toBe(4);
    expect(v.perWeek['2026-W37']).toBe(2); // the partial bucket, which is not the rate
  });

  test('the fail-soft shape still carries trailing7d, so the tile never reads undefined', () => {
    const v = velocityFromLog([], '2026-09-08');
    expect(v.trailing7d).toBe(0);
  });
});
