// renderStages draws the stages feed as the Stages grid: the repo's own stage names across the top, one row per
// workstream, one cell per stage in the feed's state. render.js is a plain browser script, so it runs in a vm
// with stub elements. What is pinned is what the reader sees: the feed's words (escaped), every cell's state,
// the legend for the states on screen, and an honest line for every state the panel can be in.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'web', 'lib', 'render.js'), 'utf8');

function page() {
  const els = {
    'lc-grid': { innerHTML: '', style: {} },
    'lc-warn': { innerHTML: '' },
    'lc-legend': { innerHTML: '', hidden: false },
    'ms-rail': { innerHTML: '' },
  };
  const sandbox = { document: { getElementById: (id) => els[id] || null } };
  vm.createContext(sandbox);
  vm.runInContext(SRC + '\n;this.__rs = renderStages; this.__rm = renderMilestones;', sandbox);
  return { renderStages: sandbox.__rs, renderMilestones: sandbox.__rm, els };
}

const STAGES = {
  stages: ['idea', 'design', 'build', 'trial', 'live'],
  milestoneStatus: null,
  warnings: [],
  workstreams: [
    {
      id: 'guest-checkout',
      name: 'Guest checkout',
      role: 'flow',
      cells: ['passed', 'inferred', 'frontier', 'none', 'none'],
      frontier: 3,
    },
    {
      id: 'saved-cards',
      name: 'Saved cards',
      role: null,
      cells: ['passed', 'failed', 'voided', 'skipped', 'none'],
      frontier: 1,
    },
    { id: 'gift-wrap', name: 'Gift wrap', role: null, cells: ['none', 'none', 'none', 'none', 'none'], frontier: null },
  ],
};
const DATA = { state: 'data' };

test("the header is the feed's own stages, numbered, and the grid has one column per stage", () => {
  const { renderStages, els } = page();
  renderStages(STAGES, DATA);
  const html = els['lc-grid'].innerHTML;
  expect(els['lc-grid'].style.gridTemplateColumns).toBe('172px repeat(5,minmax(30px,1fr))');
  expect(html.match(/class="lch"/g)).toHaveLength(5);
  expect(html).toContain('<div class="lch"><b>1</b>idea</div>');
  expect(html).toContain('<div class="lch"><b>5</b>live</div>');
});

test("each workstream is a row with its name, its role, and one cell per stage in the feed's state", () => {
  const { renderStages, els } = page();
  renderStages(STAGES, DATA);
  const html = els['lc-grid'].innerHTML;
  expect(html.match(/class="lcname /g)).toHaveLength(3);
  expect(html).toContain('<b>Guest checkout</b><small>flow</small>');
  expect(html).toContain('<b>Gift wrap</b><small>no role declared · no frontier</small>');
  const cells = [...html.matchAll(/<div class="c (\w+)" title="([^"]*)">([^<]*)<\/div>/g)];
  expect(cells).toHaveLength(15);
  expect(cells.slice(0, 5).map((c) => c[1])).toEqual(['passed', 'inferred', 'frontier', 'none', 'none']);
  expect(cells[2][3]).toBe('3'); // the frontier cell shows its stage number
  expect(cells[2][2]).toBe('build: frontier, the furthest stage reached');
  expect(cells.slice(5, 10).map((c) => c[1])).toEqual(['passed', 'failed', 'voided', 'skipped', 'none']);
});

test("the legend names exactly the states on the grid, in the format's order", () => {
  const { renderStages, els } = page();
  renderStages(STAGES, DATA);
  expect(els['lc-legend'].hidden).toBe(false);
  expect([...els['lc-legend'].innerHTML.matchAll(/class="sw (\w+)"/g)].map((m) => m[1])).toEqual([
    'passed',
    'inferred',
    'frontier',
    'skipped',
    'failed',
    'voided',
    'none',
  ]);
  renderStages({ ...STAGES, workstreams: [STAGES.workstreams[0]] }, DATA);
  expect([...els['lc-legend'].innerHTML.matchAll(/class="sw (\w+)"/g)].map((m) => m[1])).toEqual([
    'passed',
    'inferred',
    'frontier',
    'none',
  ]);
});

test('nothing a feed writes is markup: stage names, workstream names, roles and warnings are escaped', () => {
  const { renderStages, els } = page();
  const x = '<img src=x onerror=alert(1)>';
  renderStages(
    { stages: [x], warnings: [x], workstreams: [{ id: x, name: x, role: x, cells: ['frontier'], frontier: 1 }] },
    DATA
  );
  expect(els['lc-grid'].innerHTML + els['lc-warn'].innerHTML).not.toContain('<img');
  expect(els['lc-grid'].innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(els['lc-warn'].innerHTML).toContain('Feed warnings:</b> &lt;img');
});

test('not set up, off and error each say so, with an empty grid and no legend', () => {
  const { renderStages, els } = page();
  renderStages(null, { state: 'not-set-up' });
  expect(els['lc-grid'].innerHTML).toBe('');
  expect(els['lc-legend'].hidden).toBe(true);
  expect(els['lc-warn'].innerHTML).toMatch(/Not set up in this repo/);
  expect(els['lc-warn'].innerHTML).toContain('&quot;stages&quot;: { &quot;command&quot;');
  renderStages(null, { state: 'off' });
  expect(els['lc-warn'].innerHTML).toMatch(/does not use this panel/);
  renderStages(null, { state: 'error', reason: 'stages: <names> feeds/stages.json, which is not there' });
  expect(els['lc-warn'].innerHTML).toContain(
    'Could not be read: stages: &lt;names&gt; feeds/stages.json, which is not there.'
  );
});

test("the milestone rail counts the frontier against the feed's own number of stages", () => {
  const { renderMilestones, els } = page();
  renderMilestones(
    [
      { id: 'gc', title: 'Guest checkout', specImplemented: 2, specTotal: 4, frontier: 3, status: 'building' },
      { id: 'oe', title: 'Order emails', specImplemented: 0, specTotal: 0, frontier: null, status: 'no-specs' },
    ],
    { problems: [] },
    STAGES
  );
  expect(els['ms-rail'].innerHTML).toContain('2/4 scenarios · frontier 3/5');
  expect(els['ms-rail'].innerHTML).toContain('0/0 scenarios · no frontier declared');
  expect(els['ms-rail'].innerHTML).not.toContain('/13');
});
