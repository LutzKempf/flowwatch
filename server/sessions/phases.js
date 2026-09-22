const PHASE = {
  GOAL: 1,
  BRAINSTORM: 2,
  OPENSPEC: 3,
  PLAN: 4,
  EXECUTE: 5,
  TEST: 6,
  PR: 7,
  PR_GREEN: 8,
  MERGE: 9,
  VERIFY: 10,
  CLEANUP: 11,
  DONE: 12,
};
const PHASE_NAME = {
  1: 'Goal',
  2: 'Brainstorm',
  3: 'OpenSpec',
  4: 'Plan',
  5: 'Execute',
  6: 'Test+Hunt',
  7: 'PR',
  8: 'PR green',
  9: 'Merge',
  10: 'Verify',
  11: 'Cleanup',
  12: 'Done',
};
const PHASE_COUNT = Object.keys(PHASE).length; // 12 — the single source for phase-loop bounds
module.exports = { PHASE, PHASE_NAME, PHASE_COUNT };
