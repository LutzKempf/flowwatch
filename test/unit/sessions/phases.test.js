const { PHASE, PHASE_NAME } = require('../../../server/sessions/phases');
test('12 phases, numbered 1..12, each named', () => {
  expect(PHASE.GOAL).toBe(1);
  expect(PHASE.DONE).toBe(12);
  expect(Object.keys(PHASE)).toHaveLength(12);
  expect(PHASE_NAME[PHASE.PR_GREEN]).toBe('PR green');
});

test('PHASE_COUNT matches the phase table', () => {
  const { PHASE_COUNT } = require('../../../server/sessions/phases');
  expect(PHASE_COUNT).toBe(12);
});
