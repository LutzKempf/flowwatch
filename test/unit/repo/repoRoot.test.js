const { canonicalRepoRoot } = require('../../../server/repo/repoRoot');

// A collector started inside a worktree scoped the inbox to that one worktree, so every session in
// every sibling worktree was filtered out and the endpoint answered "nothing is waiting on you"
// with dozens waiting. Anyone developing the collector starts it exactly that way.
test('a worktree resolves to the repo it belongs to', () => {
  expect(canonicalRepoRoot('C:/git_repos/repo/.claude/worktrees/wtA')).toBe('C:/git_repos/repo');
  expect(canonicalRepoRoot('C:\\git_repos\\repo\\.claude\\worktrees\\wtA\\tools')).toBe('C:/git_repos/repo');
});

test('the canonical checkout is already the repo root', () => {
  expect(canonicalRepoRoot('C:/git_repos/repo')).toBe('C:/git_repos/repo');
  expect(canonicalRepoRoot('C:/git_repos/repo/tools')).toBe('C:/git_repos/repo/tools');
});

test('an empty path stays empty', () => {
  expect(canonicalRepoRoot('')).toBe('');
  expect(canonicalRepoRoot(undefined)).toBe('');
});
