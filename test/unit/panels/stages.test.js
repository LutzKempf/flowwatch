// The stages feed's format: the repo's own stages (names only it knows), and one row of cell states per
// workstream. Flowwatch reads no stage vocabulary of its own: the names, and the milestone labels, are the feed's.
const { checkStages, frontierOf, CELL_STATES } = require('../../../server/panels/stages');

const STAGES = ['idea', 'design', 'build', 'trial', 'live'];
const row = (id, cells, extra = {}) => ({ id, name: 'Row ' + id, cells, ...extra });
const feed = (o = {}) => ({
  format: 1,
  stages: STAGES,
  workstreams: [row('guest-checkout', ['passed', 'inferred', 'frontier', 'none', 'none'], { role: 'flow' })],
  ...o,
});

test('the seven cell states are exactly the ones a feed may use', () => {
  expect(CELL_STATES).toEqual(['passed', 'inferred', 'frontier', 'skipped', 'failed', 'voided', 'none']);
});

test('a feed with stages, milestone labels, workstreams and warnings passes', () => {
  expect(
    checkStages(
      feed({
        milestoneStatus: ['proposed', 'designed', 'building', 'in trial', 'live'],
        warnings: ['one row was left out'],
      })
    )
  ).toEqual([]);
  expect(checkStages(feed({ workstreams: [] }))).toEqual([]); // no rows yet is a state, not an error
});

test('stages must be a list of 1 to 20 names, each named once', () => {
  expect(checkStages(feed({ stages: undefined }))).toEqual(['"stages" must be a list of stage names']);
  expect(checkStages(feed({ stages: [] }))).toEqual(['"stages" is empty']);
  expect(checkStages(feed({ stages: Array.from({ length: 21 }, (_, i) => 's' + i), workstreams: [] }))).toEqual([
    '"stages" has 21 entries; at most 20',
  ]);
  expect(checkStages(feed({ stages: ['idea', '', 'idea', 3, 'live'], workstreams: [] }))).toEqual([
    'stages[1] must be a name',
    'stages[2] "idea" is used twice',
    'stages[3] must be a name',
  ]);
});

test('milestoneStatus, when given, is one label per stage', () => {
  expect(checkStages(feed({ milestoneStatus: ['a', 'b'] }))).toEqual([
    '"milestoneStatus" has 2 labels; it needs one per stage (5)',
  ]);
  expect(checkStages(feed({ milestoneStatus: 'live' }))).toEqual(['"milestoneStatus" must be a list of labels']);
  expect(checkStages(feed({ milestoneStatus: ['a', 'b', '', 'd', null] }))).toEqual([
    'milestoneStatus[2] must be a label',
    'milestoneStatus[4] must be a label',
  ]);
});

test('every problem in the workstreams is named: id, name, role, cell count, cell state, frontier count', () => {
  expect(checkStages(feed({ workstreams: 'x' }))).toEqual(['"workstreams" must be a list']);
  expect(
    checkStages(
      feed({
        workstreams: [
          null,
          { name: 'No id', cells: ['none', 'none', 'none', 'none', 'none'] },
          row('a', ['passed', 'none']),
          row('a', ['passed', 'done', 'none', 'none', 'none']),
          { id: 'b', cells: ['none', 'none', 'none', 'none', 'none'], role: 7 },
          row('c', 'passed'),
          row('d', ['frontier', 'frontier', 'none', 'none', 'none']),
        ],
      })
    )
  ).toEqual([
    'workstreams[0] must be an object',
    'workstreams[1].id must be a name',
    'workstreams[2] has 2 cells; it needs one per stage (5)',
    'workstreams[3].id "a" is used twice',
    'workstreams[3].cells[1] "done" is not one of passed, inferred, frontier, skipped, failed, voided, none',
    'workstreams[4].name must be a name',
    'workstreams[4].role must be text',
    'workstreams[5].cells must be a list',
    'workstreams[6] has 2 frontier cells; at most one',
  ]);
});

test('warnings, when given, are a list of sentences', () => {
  expect(checkStages(feed({ warnings: 'x' }))).toEqual(['"warnings" must be a list of sentences']);
  expect(checkStages(feed({ warnings: ['ok', 3] }))).toEqual(['warnings[1] must be a sentence']);
});

describe('frontierOf — how far a workstream has got, as a 1-based stage number', () => {
  test.each([
    [['passed', 'inferred', 'frontier', 'none'], 3],
    [['passed', 'frontier', 'failed', 'voided'], 2], // a failure after the frontier does not move it
    [['passed', 'passed', 'failed', 'none'], 2], // no frontier cell: the furthest passed stage
    [['inferred', 'skipped', 'none', 'none'], 1], // assumed counts as passed; skipped does not
    [['none', 'none', 'none', 'none'], null], // nothing reached: no frontier, never 0
    [['skipped', 'failed', 'voided', 'none'], null],
  ])('%j → %p', (cells, frontier) => {
    expect(frontierOf(cells)).toBe(frontier);
  });
});
