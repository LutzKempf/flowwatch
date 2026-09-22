// ~/.claude/projects holds every repo's transcripts, so walking all of it would import another repo's whole
// history into a new repo's board on its first start. The one-time backfill imports only the repo's own
// transcript folders: the checkout and its .claude/worktrees/, which Claude Code names after the path with
// every non-alphanumeric character a dash.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../../server/db');
const { backfillDir, projectDirFilter } = require('../../server/sessions/runBackfill');

const FIXTURE = path.join(__dirname, '../fixtures/transcript.jsonl');

test("the filter keeps the repo's own folder and its worktrees, never a sibling repo that shares a prefix", () => {
  const keep = projectDirFilter('C:\\git_repos\\flowwatch-fresh');
  expect(
    [
      'C--git-repos-flowwatch-fresh',
      'C--git-repos-flowwatch-fresh--claude-worktrees-wt-a',
      'C--git-repos-flowwatch-fresh-2',
      'C--git-repos-some-other-repo',
    ].map(keep)
  ).toEqual([true, true, false, false]);
});

test("with a filter, only the repo's own sessions are backfilled", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-scope-'));
  for (const [dir, id] of [
    ['C--x-repo', 'mine-1'],
    ['C--x-repo--claude-worktrees-wt', 'mine-2'],
    ['C--x-repo-2', 'sibling'],
    ['C--x-other', 'other'],
  ]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.copyFileSync(FIXTURE, path.join(root, dir, id + '.jsonl'));
  }
  const db = openDb(':memory:');
  backfillDir(db, root, { keepProject: projectDirFilter('C:\\x\\repo') });
  expect(
    db
      .prepare('SELECT id FROM sessions ORDER BY id')
      .all()
      .map((r) => r.id)
  ).toEqual(['mine-1', 'mine-2']);
  db.close();
});
