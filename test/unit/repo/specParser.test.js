const path = require('path');
const { countTags, parseSpecsDir } = require('../../../server/repo/specParser');

test('countTags tallies the four statuses in one feature file', () => {
  const c = countTags(path.join(__dirname, '../../fixtures/specs/sample.feature'));
  expect(c).toEqual({ implemented: 2, known_broken: 1, aspirational: 0 + 1, not_applicable: 0, total: 4 });
});

test('parseSpecsDir returns a per-capability map + totals', () => {
  const out = parseSpecsDir(path.join(__dirname, '../../fixtures/specs'));
  expect(out.capabilities.sample.implemented).toBe(2);
  expect(out.totals.total).toBe(4);
});
