const WORKTREES = '/.claude/worktrees/';

/**
 * The repo a collector should scope its inbox to, given where it was started.
 *
 * A collector started from the canonical checkout already has it. Started from inside a worktree —
 * which is where anyone developing the collector runs it — `process.cwd()` is that one worktree, and
 * scoping to it hides every other session on the box: the inbox answers "nothing is waiting on you"
 * while dozens are. Claude Code keeps a repo's worktrees under `.claude/worktrees/`, so the canonical
 * root is the path above that folder.
 * @param {string} dir where the collector was started
 * @returns {string} the canonical repo root
 */
function canonicalRepoRoot(dir) {
  const slashed = String(dir || '').replace(/\\/g, '/');
  const i = slashed.toLowerCase().indexOf(WORKTREES);
  return i === -1 ? String(dir || '') : slashed.slice(0, i);
}

module.exports = { canonicalRepoRoot };
