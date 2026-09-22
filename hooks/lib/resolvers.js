const { execFileSync } = require('child_process');

/**
 * Default commit-file lister: `git show HEAD` in the given directory.
 * @param {string} [cwd] repo dir to run git in (hook payload's cwd — NOT this
 *   process's cwd, which may be outside the worktree that committed)
 * @returns {string[]} files touched by HEAD
 */
function defaultList(cwd) {
  return execFileSync('git', ['show', '--name-only', '--pretty=format:', 'HEAD'], { encoding: 'utf8', cwd })
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Whether one changed path is documentation rather than code.
 * @param {string} f a path from the commit's file list
 * @returns {boolean} true for Markdown, and for anything under a docs/ directory
 */
function isDoc(f) {
  const p = f.replace(/\\/g, '/');
  return /\.md$/i.test(p) || /(^|\/)docs\//i.test(p);
}

/**
 * Whether the HEAD commit touches code — stated as "not documentation" rather than as a list
 * of code folders. Every repo lays out its code differently, and a list of folders misses every
 * commit outside them (tooling, scripts, files at the repo root), which then reads as no code.
 * @param {{list?: (cwd?: string) => string[], cwd?: string}} [opts]
 *   list: injectable lister (tests); cwd: repo dir forwarded to the lister
 * @returns {boolean} false on any git failure (fail-closed: not a code commit)
 */
function commitTouchesCode({ list = defaultList, cwd } = {}) {
  try {
    return list(cwd).some((f) => !isDoc(f));
  } catch {
    return false;
  }
}

module.exports = { commitTouchesCode };
