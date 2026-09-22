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

// A repo path of this platform's own shape, and the folder name Claude Code gives it there.
const [REPO, SLUG] =
  process.platform === 'win32' ? ['C:\\code\\shop', 'C--code-shop'] : ['/srv/code/shop', '-srv-code-shop'];

test("the filter keeps the repo's own folder and its worktrees, never a sibling repo that shares a prefix", () => {
  const keep = projectDirFilter(REPO);
  expect([SLUG, SLUG + '--claude-worktrees-wt-a', SLUG + '-2', SLUG.replace('shop', 'other')].map(keep)).toEqual([
    true,
    true,
    false,
    false,
  ]);
});

test("with a filter, only the repo's own sessions are backfilled", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-scope-'));
  for (const [dir, id] of [
    [SLUG, 'mine-1'],
    [SLUG + '--claude-worktrees-wt', 'mine-2'],
    [SLUG + '-2', 'sibling'],
    [SLUG.replace('shop', 'other'), 'other'],
  ]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.copyFileSync(FIXTURE, path.join(root, dir, id + '.jsonl'));
  }
  const db = openDb(':memory:');
  backfillDir(db, root, { keepProject: projectDirFilter(REPO) });
  expect(
    db
      .prepare('SELECT id FROM sessions ORDER BY id')
      .all()
      .map((r) => r.id)
  ).toEqual(['mine-1', 'mine-2']);
  db.close();
});
