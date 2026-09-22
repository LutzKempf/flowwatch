const { worktreeOf: inboxWorktreeOf } = require('../../../server/sessions/buildInbox');
const { worktreeOf: hookWorktreeOf } = require('../../../hooks/lib/mapHookEvent');

// The inbox joins a session to its board row by worktree name; the hook emitter is what wrote that
// name. A disagreement costs every phase join silently, so the two are pinned against each other —
// the same shape as tests/unit/eventRules.parity.test.js.
const CASES = [
  'C:/git_repos/repo/.claude/worktrees/wtA',
  'C:\\git_repos\\repo\\.claude\\worktrees\\wtA',
  'C:/git_repos/repo/.claude/worktrees/wtA/tools',
  'C:/git_repos/repo',
  '',
];

test.each(CASES)('the inbox and the emitter agree on %p', (cwd) => {
  expect(inboxWorktreeOf(cwd)).toBe(hookWorktreeOf(cwd));
});
