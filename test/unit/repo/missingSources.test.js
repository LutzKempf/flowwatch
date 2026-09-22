// A repo without openspec/specs has no specs yet: that is a state to show, not a failure. A throw here
// would answer /api/mission with a 500, and the page would say "collector offline".
const os = require('os');
const path = require('path');
const { parseSpecsDir } = require('../../../server/repo/specParser');
const { parseChanges } = require('../../../server/repo/changesParser');

const nowhere = path.join(os.tmpdir(), 'no-openspec-' + process.pid, 'specs');

test('a missing specs folder reads as no specs yet, and says it is missing', () => {
  expect(parseSpecsDir(nowhere)).toEqual({
    capabilities: {},
    totals: { implemented: 0, known_broken: 0, aspirational: 0, not_applicable: 0, total: 0 },
    missing: true,
  });
});

test('a missing changes folder reads as no changes yet, and says it is missing', () => {
  expect(parseChanges(nowhere)).toEqual({ active: [], byLane: {}, archivedCount: 0, missing: true });
});
