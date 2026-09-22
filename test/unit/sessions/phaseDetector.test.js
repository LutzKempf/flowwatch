const { phaseForEvent, detectPhase } = require('../../../server/sessions/phaseDetector');
const { PHASE } = require('../../../server/sessions/phases');

test('each signal maps to its phase', () => {
  expect(phaseForEvent({ type: 'session_start' })).toBe(PHASE.GOAL);
  expect(phaseForEvent({ type: 'skill', name: 'brainstorming' })).toBe(PHASE.BRAINSTORM);
  expect(phaseForEvent({ type: 'file_change', path: 'openspec/changes/2026-07-03-x/proposal.md' })).toBe(
    PHASE.OPENSPEC
  );
  expect(phaseForEvent({ type: 'file_change', path: 'docs/x/tasks.md' })).toBe(PHASE.PLAN);
  expect(phaseForEvent({ type: 'commit', touchesCode: true })).toBe(PHASE.EXECUTE);
  expect(phaseForEvent({ type: 'bash', command: 'npm run test:unit' })).toBe(PHASE.TEST);
  expect(phaseForEvent({ type: 'bash', command: 'gh pr create --fill' })).toBe(PHASE.PR);
  expect(phaseForEvent({ type: 'gate_pass' })).toBe(PHASE.PR_GREEN);
  expect(phaseForEvent({ type: 'goal_pass' })).toBe(PHASE.PR_GREEN);
  expect(phaseForEvent({ type: 'merge' })).toBe(PHASE.MERGE);
  expect(phaseForEvent({ type: 'verify' })).toBe(PHASE.VERIFY);
  expect(phaseForEvent({ type: 'worktree_remove' })).toBe(PHASE.CLEANUP);
  expect(phaseForEvent({ type: 'user_prompt' })).toBeNull();
});

test('the common test runners count as testing; a command that only mentions testing does not', () => {
  for (const command of [
    'npm test',
    'yarn test --watch=false',
    'pnpm run test:unit',
    'npx jest server',
    'npx vitest run',
    'python -m pytest -q',
    'go test ./...',
    'cargo test',
  ])
    expect([command, phaseForEvent({ type: 'bash', command })]).toEqual([command, PHASE.TEST]);
  for (const command of ['git commit -m "add latest tests"', 'cat test-results.txt', 'npm run gate'])
    expect([command, phaseForEvent({ type: 'bash', command })]).toEqual([command, null]);
});

test('current phase is the max reached, robust to out-of-order noise', () => {
  const events = [
    { type: 'session_start' },
    { type: 'bash', command: 'gh pr create' }, // PR (7)
    { type: 'commit', touchesCode: true }, // EXECUTE (5) — earlier, must not regress
  ];
  expect(detectPhase(events)).toBe(PHASE.PR);
});

test('Windows backslash paths still detect their phase', () => {
  expect(phaseForEvent({ type: 'file_change', path: 'openspec\\changes\\x\\proposal.md' })).toBe(PHASE.OPENSPEC);
});
