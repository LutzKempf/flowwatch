const { velocityFromLog } = require('../../../server/repo/gitVelocity');

test('counts merge/PR commits per ISO week from injected log lines', () => {
  const lines = ['2026-07-02\tfeat: a (#53)', '2026-07-01\tfix: b (#52)', '2026-06-24\tfeat: c (#40)'];
  const v = velocityFromLog(lines);
  expect(v.totalPRs).toBe(3);
  expect(v.perWeek['2026-W27']).toBe(2); // 06-29..07-05
  expect(v.perWeek['2026-W26']).toBe(1);
});

test('perWeek keys are sorted ascending so slice(-1) is the LATEST week (git log is newest-first)', () => {
  // git log emits newest-first: current-week commits FIRST. Insertion order must not leak
  // into key order or the dashboard's "PRs/week (latest)" tile reads the OLDEST week.
  const lines = [
    '2026-07-10\tfeat: newest (#60)', // current week, W28
    '2026-07-09\tfix: also new (#59)', // W28
    '2026-06-24\tfeat: old (#40)', // W26
    '2026-07-01\tfeat: mid (#45)', // W27
  ];
  const keys = Object.keys(velocityFromLog(lines).perWeek);
  expect(keys).toEqual(['2026-W26', '2026-W27', '2026-W28']);
  expect(keys.slice(-1)[0]).toBe('2026-W28');
});

// ─── a partial ISO week is not a rate ─────────────────────────────────────────
// Just after a new ISO week begins, its bucket holds a day or two of merges. Both
// buckets are correct counts, and a tile reading the latest one as "PRs / week"
// still misstates the rate. A trailing 7-day window is always a whole window, so
// it cannot swing on a calendar boundary.
const { velocityFromLog: vel } = require('../../../server/repo/gitVelocity');

test('trailing7d counts PRs in the last 7 days, not the current ISO week', () => {
  // 2026-09-08 is a Tuesday: the ISO week holds 2 days, the trailing window 7.
  const lines = [
    '2026-09-08\tfeat: a (#90)',
    '2026-09-07\tfeat: b (#91)',
    '2026-09-05\tfeat: c (#92)', // previous ISO week, still inside 7 days
    '2026-09-03\tfeat: d (#93)', // previous ISO week, still inside 7 days
    '2026-08-20\tfeat: e (#94)', // outside
  ];
  const v = vel(lines, '2026-09-08');
  expect(v.trailing7d).toBe(4);
  expect(v.perWeek['2026-W37']).toBe(2); // the misleading partial bucket
});

test('the window spans exactly seven calendar dates, D-6 through D', () => {
  // The dates are day-granular, so an inclusive `<= 7 days` would span D-7..D —
  // eight dates under a tile that says seven. D-6 is in, D-7 is out.
  const days = ['2026-09-08', '2026-09-07', '2026-09-06', '2026-09-05', '2026-09-04', '2026-09-03', '2026-09-02'];
  const lines = days.map((d, i) => `${d}\tfeat: x (#${70 + i})`);
  expect(vel(lines, '2026-09-08').trailing7d).toBe(7);

  expect(vel(['2026-09-02\tfeat: x (#80)'], '2026-09-08').trailing7d).toBe(1); // D-6, in
  expect(vel(['2026-09-01\tfeat: x (#81)'], '2026-09-08').trailing7d).toBe(0); // D-7, out
});

test('a commit dated in the future is not counted', () => {
  // git --date=short is the AUTHOR's local date; a clock skew or a rebase can put
  // it ahead of the anchor. Counting it would inflate the headline velocity.
  expect(vel(['2026-09-09\tfeat: x (#83)'], '2026-09-08').trailing7d).toBe(0);
});

test('the default anchor is the local date, matching git --date=short', () => {
  const { localToday } = require('../../../server/repo/gitVelocity');
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  expect(localToday()).toBe(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
});

test('a commit 8 days old is outside the window', () => {
  const v = vel(['2026-08-31\tfeat: x (#84)'], '2026-09-08');
  expect(v.trailing7d).toBe(0);
});

test('non-PR commits are excluded from the trailing window too', () => {
  const v = vel(['2026-09-08\tchore: no pr number here'], '2026-09-08');
  expect(v.trailing7d).toBe(0);
});

test('a folder git cannot read counts nothing and warns once, not on every refresh', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { velocityFromRepo } = require('../../../server/repo/gitVelocity');
  const dirs = [1, 2].map(() => fs.mkdtempSync(path.join(os.tmpdir(), 'fw-nogit-')));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const warned = new Set();
    for (const d of [dirs[0], dirs[0], dirs[0], dirs[1]]) {
      expect(velocityFromRepo(d, '8 weeks ago', warned)).toEqual({ totalPRs: 0, perWeek: {}, trailing7d: 0 });
    }
    expect(warn).toHaveBeenCalledTimes(2);
  } finally {
    warn.mockRestore();
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
});
