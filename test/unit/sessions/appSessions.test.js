const fs = require('fs');
const os = require('os');
const path = require('path');
const { readAppSessions, activityAt } = require('../../../server/sessions/appSessions');

test('a record with no readable activity time is dated 0, not to a parse of "0" (which is the year 2000)', () => {
  for (const v of [undefined, null, 0, '', 'soon', {}, NaN])
    expect([v, activityAt(/** @type {any} */ (v))]).toEqual([v, 0]);
  expect(activityAt('2026-09-01T00:00:00Z')).toBe(Date.UTC(2026, 8, 1));
  expect(activityAt(1756684800000)).toBe(1756684800000);
});

function record(dir, name, rec) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(rec));
}

function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-'));
  record(path.join(root, 'a'), 'local_1.json', {
    sessionId: 'local_1',
    cliSessionId: 'cli-1',
    cwd: 'C:/repo/.claude/worktrees/wtA',
    title: 'Retro: fix the gate',
    branch: 'claude/wt-a',
    lastActivityAt: '2026-09-13T10:00:00.000Z',
  });
  record(path.join(root, 'a'), 'local_1b.json', {
    sessionId: 'local_1b',
    cliSessionId: 'cli-1',
    cwd: 'C:/repo/.claude/worktrees/wtA',
    title: 'Retro: fix the gate',
    branch: 'claude/wt-a',
    lastActivityAt: '2026-09-14T10:00:00.000Z',
  });
  record(path.join(root, 'b'), 'local_2.json', {
    sessionId: 'local_2',
    cliSessionId: 'cli-2',
    cwd: 'D:/other/repo',
    title: 'Elsewhere',
  });
  record(path.join(root, 'b'), 'local_3.json', {
    sessionId: 'local_3',
    cliSessionId: 'cli-3',
    cwd: 'C:/repo',
    title: 'Archived',
    isArchived: true,
  });
  record(path.join(root, 'b'), 'local_4.json', {
    sessionId: 'local_4',
    cliSessionId: 'cli-4',
    cwd: 'C:/repo',
    title: 'Routine',
    scheduledTaskId: 'task-9',
  });
  return root;
}

// Scheduled runs are kept: a finished routine waits for the operator like any session.
test('keeps this repo live sessions, scheduled runs included, newest record per lineage', () => {
  const out = readAppSessions({ dir: tree(), repoRoot: 'C:/repo' });
  expect(out.records.map((r) => r.sessionId).sort()).toEqual(['local_1b', 'local_4']);
  expect(out.records[0].title).toBe('Retro: fix the gate');
  expect(out.readable).toBe(true);
});

// A sibling checkout shares the prefix of the repo it sits beside; its sessions are not this repo's.
test('a sibling checkout with the same prefix is not this repo', () => {
  const root = tree();
  record(path.join(root, 'c'), 'local_5.json', {
    sessionId: 'local_5',
    cliSessionId: 'cli-5',
    cwd: 'C:/repo-2/.claude/worktrees/wtX',
    title: 'Neighbour',
    lastActivityAt: '2026-09-14T10:00:00.000Z',
  });
  const out = readAppSessions({ dir: root, repoRoot: 'C:/repo' });
  expect(out.records.map((r) => r.sessionId).sort()).toEqual(['local_1b', 'local_4']);
});

test('records last active before the cutoff are skipped', () => {
  const out = readAppSessions({ dir: tree(), repoRoot: 'C:/repo', since: Date.parse('2026-09-14T11:00:00.000Z') });
  expect(out.records).toHaveLength(0);
});

// The app writes lastActivityAt as epoch milliseconds in current versions and as an ISO string in
// older ones, and both shapes sit in the folder today. Reading only one dates the rest to 1970,
// which the cutoff then drops — an empty inbox on a box with dozens of sessions waiting.
test('both shapes of lastActivityAt are understood', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-ts-'));
  record(root, 'local_epoch.json', {
    sessionId: 'local_epoch',
    cliSessionId: 'cli-epoch',
    cwd: 'C:/repo',
    title: 'Epoch',
    lastActivityAt: Date.parse('2026-09-14T11:30:00.000Z'),
  });
  record(root, 'local_iso.json', {
    sessionId: 'local_iso',
    cliSessionId: 'cli-iso',
    cwd: 'C:/repo',
    title: 'Iso',
    lastActivityAt: '2026-09-14T11:30:00.000Z',
  });

  const out = readAppSessions({ dir: root, repoRoot: 'C:/repo', since: Date.parse('2026-09-14T11:00:00.000Z') });
  expect(out.records.map((r) => r.sessionId).sort()).toEqual(['local_epoch', 'local_iso']);
});

test('the newest record of a lineage wins whichever shape its time has', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-mix-'));
  record(root, 'local_a.json', {
    sessionId: 'local_a',
    cliSessionId: 'cli-x',
    cwd: 'C:/repo',
    title: 'Older',
    lastActivityAt: '2026-09-14T10:00:00.000Z',
  });
  record(root, 'local_b.json', {
    sessionId: 'local_b',
    cliSessionId: 'cli-x',
    cwd: 'C:/repo',
    title: 'Newer',
    lastActivityAt: Date.parse('2026-09-14T11:00:00.000Z'),
  });

  const out = readAppSessions({ dir: root, repoRoot: 'C:/repo' });
  expect(out.records.map((r) => r.sessionId)).toEqual(['local_b']);
});

// An unreadable records root is not an empty inbox: the caller has to be able to tell them apart.
test('an unreadable records root reports itself', () => {
  const out = readAppSessions({ dir: path.join(os.tmpdir(), 'does-not-exist-' + Date.now()), repoRoot: 'C:/repo' });
  expect(out.records).toHaveLength(0);
  expect(out.readable).toBe(false);
});

// A records folder that is not there (Linux, or the app never installed) is a different fact from one that is
// there and cannot be read: the board then says it runs on the hooks alone, and where it looked.
test('a records folder that is not there, or none at all, is not found; an empty one is found', () => {
  expect(
    readAppSessions({ dir: path.join(os.tmpdir(), 'does-not-exist-' + Date.now()), repoRoot: 'C:/repo' }).found
  ).toBe(false);
  expect(readAppSessions({ dir: null, repoRoot: 'C:/repo' })).toEqual({ records: [], readable: false, found: false });
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'records-'));
  expect(readAppSessions({ dir: empty, repoRoot: 'C:/repo' })).toEqual({ records: [], readable: true, found: true });
  expect(readAppSessions({ dir: tree(), repoRoot: 'C:/repo' }).found).toBe(true);
});

// The lanes payload names every board session, so it needs archived sessions' titles. The inbox
// default still leaves archived sessions out.
test('all: true keeps archived sessions and scheduled runs, still scoped to the repo', () => {
  const out = readAppSessions({ dir: tree(), repoRoot: 'C:/repo', all: true });
  expect(out.records.map((r) => r.sessionId).sort()).toEqual(['local_1b', 'local_3', 'local_4']);
});
