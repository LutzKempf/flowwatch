const { buildLanes } = require('../../../server/sessions/buildLanes');
// The repo's categories, as MISSION.md gives them to the collector (a made-up shop's).
const CATS = ['Checkout', 'Payments', 'Reporting', 'Notifications', 'Billing', 'Retro', 'Architecture'];

const NOW = Date.parse('2026-09-15T12:00:00.000Z');

const phases = (work, wait, tokens, inputs) => [
  { phase: 1, work_ms: work, wait_ms: wait, inputs, tokens_usd: 0, tokens },
  { phase: 2, work_ms: 0, wait_ms: 0, inputs: 0, tokens_usd: 0, tokens: 0 },
];
const board = (over) => ({
  id: 'cli-1',
  worktree: 'wt-a',
  current_phase: 2,
  state: 'waiting',
  stale: false,
  archived: false,
  origin: 'live',
  last_seen: NOW - 60000,
  phases: phases(1000, 2000, 30, 1),
  ...over,
});
const record = (over) => ({
  sessionId: 'local_1',
  cliSessionId: 'cli-1',
  title: 'Retro: close the guard',
  branch: 'claude/guard',
  cwd: 'C:/repo/.claude/worktrees/wt-a',
  isArchived: false,
  ...over,
});
// A stand-in for the repo's inference: matches a lane name anywhere in the text.
const inferCategory = (...s) => {
  const hay = s.filter(Boolean).join(' ').toLowerCase();
  return hay.includes('report') ? 'Reporting' : hay.includes('payment') ? 'Payments' : null;
};
const lane = (out, name) => out.lanes.find((l) => l.name === name);

// One app record per board session, titled so the stand-in inference can place it.
const recordsFor = (sessions, titleOf) =>
  sessions.map((s, i) =>
    record({
      sessionId: `local_${s.id}`,
      cliSessionId: s.id,
      title: titleOf ? titleOf(s, i) : `Work in ${s.worktree}`,
      branch: null,
    })
  );

test('a session with an app record takes its title and category from it, joined on the CLI session id', () => {
  const out = buildLanes({ categories: CATS, sessions: [board()], records: [record()], inferCategory, now: NOW });
  const row = lane(out, 'Retro').sessions[0];
  expect(row).toMatchObject({
    id: 'cli-1',
    title: 'Retro: close the guard',
    app_session_id: 'local_1',
    branch: 'claude/guard',
    category: 'Retro',
    category_from: 'title prefix',
    app_archived: false,
  });
});

// Board sessions with no app record are subagents and headless runs, stuck at phase 1. Laned, they would
// bury the real sessions in "No category"; counted, nothing is lost.
test('a board session with no app record is counted, not put in a lane', () => {
  const out = buildLanes({
    categories: CATS,
    sessions: [board({ id: 'cli-9', worktree: 'report-host' })],
    records: [],
    inferCategory,
    now: NOW,
  });
  expect(out.lanes).toEqual([]);
  expect(out.without_app_record).toBe(1);
});

// A record for another session on a recycled worktree must never lend this session its title.
test('a record is joined only on the id, never on the worktree', () => {
  const out = buildLanes({
    categories: CATS,
    sessions: [board({ id: 'cli-2', worktree: 'wt-a' })],
    records: [record({ cliSessionId: 'cli-1', cwd: 'C:/repo/.claude/worktrees/wt-a' })],
    inferCategory,
    now: NOW,
  });
  expect(out.lanes.flatMap((l) => l.sessions)).toEqual([]);
  expect(out.without_app_record).toBe(1);
});

test('every current session with a record lands in exactly one lane, and one with no category is kept, not dropped', () => {
  const sessions = [board({ id: 'a' }), board({ id: 'b' }), board({ id: 'c' })];
  const records = recordsFor(sessions, (s) => (s.id === 'a' ? 'Payments: tune the retries' : `Work on ${s.id}`));
  const out = buildLanes({ categories: CATS, sessions, records, inferCategory, now: NOW });
  expect(out.lanes.flatMap((l) => l.sessions.map((s) => s.id)).sort()).toEqual(['a', 'b', 'c']);
  expect(
    lane(out, null)
      .sessions.map((s) => s.id)
      .sort()
  ).toEqual(['b', 'c']);
});

test('archived board sessions stay out of the cards, the same set the tiles and rollup count', () => {
  const out = buildLanes({
    categories: CATS,
    sessions: [board({ id: 'old', archived: true })],
    records: [],
    inferCategory,
    now: NOW,
  });
  expect(out.lanes.flatMap((l) => l.sessions)).toEqual([]);
});

test('scheduled-task runs stay out of the lanes and are counted', () => {
  const out = buildLanes({
    categories: CATS,
    sessions: [board({ id: 'cli-r' })],
    records: [record({ cliSessionId: 'cli-r', title: 'Nightly graphify', scheduledTaskId: 'task-1' })],
    inferCategory,
    now: NOW,
  });
  expect(out.lanes.flatMap((l) => l.sessions)).toEqual([]);
  expect(out.routine_runs).toBe(1);
});

// The Session × phase board lists every current board session, scheduled runs included, and names each
// by its title — joined on the id like the lanes, never on the worktree.
test('titles name every current board session that has an app record, scheduled runs included', () => {
  const out = buildLanes({
    categories: CATS,
    sessions: [
      board({ id: 'a' }),
      board({ id: 'r' }),
      board({ id: 'x', worktree: 'wt-x' }),
      board({ id: 'old', archived: true }),
    ],
    records: [
      record({ cliSessionId: 'a', sessionId: 'local_a', title: 'Reporting: fix the totals' }),
      record({
        cliSessionId: 'r',
        sessionId: 'local_r',
        title: 'Nightly graphify',
        scheduledTaskId: 'task-1',
        isArchived: true,
      }),
      record({ cliSessionId: 'old', sessionId: 'local_old', title: 'Long gone' }),
    ],
    inferCategory,
    now: NOW,
  });
  expect(out.titles).toEqual({
    a: {
      title: 'Reporting: fix the totals',
      app_session_id: 'local_a',
      app_archived: false,
      branch: 'claude/guard',
      category: 'Reporting',
      category_from: 'title prefix',
    },
    r: {
      title: 'Nightly graphify',
      app_session_id: 'local_r',
      app_archived: true,
      branch: 'claude/guard',
      category: null,
      category_from: null,
    },
  });
});

// The app continues a conversation that ran out of context under a new CLI id and keeps the old ones in
// priorCliSessionIds. Shown as rows of their own, the earlier parts would put one session on the board
// several times.
test('the earlier parts of a continued session fold into one row, the most recently seen', () => {
  const out = buildLanes({
    categories: CATS,
    sessions: [
      board({ id: 'part-1', last_seen: NOW - 3 * 3600000, current_phase: 8 }),
      board({ id: 'part-2', last_seen: NOW - 60000, current_phase: 7 }),
      board({ id: 'part-0', last_seen: NOW - 9 * 3600000, current_phase: 5 }),
    ],
    records: [
      record({
        cliSessionId: 'part-2',
        priorCliSessionIds: ['part-0', 'part-1'],
        sessionId: 'local_m',
        title: 'Retro: research the dashboard',
      }),
    ],
    inferCategory,
    now: NOW,
  });
  expect(Object.keys(out.titles)).toEqual(['part-2']);
  expect(out.lanes.flatMap((l) => l.sessions.map((s) => [s.id, s.phase]))).toEqual([['part-2', 7]]);
  expect(out.earlier_parts).toBe(2);
  expect(out.without_app_record).toBe(0);
});

test("a lane carries its waiting count and totals summed from its sessions' phases", () => {
  const sessions = [
    board({ id: 'a', state: 'waiting', phases: phases(1000, 2000, 30, 1) }),
    board({ id: 'b', state: 'working', phases: phases(500, 0, 12, 4) }),
  ];
  const records = recordsFor(sessions, () => 'Payments: one of two');
  const l = lane(buildLanes({ categories: CATS, sessions, records, inferCategory, now: NOW }), 'Payments');
  expect(l.waiting).toBe(1);
  expect(l.totals).toEqual({ work_ms: 1500, wait_ms: 2000, tokens: 42, inputs: 5 });
  expect(l.sessions.map((s) => s.totals)).toEqual([
    { work_ms: 1000, wait_ms: 2000, tokens: 30, inputs: 1 },
    { work_ms: 500, wait_ms: 0, tokens: 12, inputs: 4 },
  ]);
});

test("lanes come in MISSION.md's category order, then No category, and empty lanes are left out", () => {
  const sessions = [board({ id: 'a' }), board({ id: 'b' }), board({ id: 'c' })];
  const titles = { a: 'Plain work', b: 'Reporting: fix the totals', c: 'Payments: widen' };
  const out = buildLanes({
    categories: CATS,
    sessions,
    records: recordsFor(sessions, (s) => titles[s.id]),
    inferCategory,
    now: NOW,
  });
  expect(out.lanes.map((l) => l.name)).toEqual(['Payments', 'Reporting', null]);
  const reordered = buildLanes({
    categories: ['Reporting', 'Payments'],
    sessions,
    records: recordsFor(sessions, (s) => titles[s.id]),
    inferCategory,
    now: NOW,
  });
  expect(reordered.lanes.map((l) => l.name)).toEqual(['Reporting', 'Payments', null]);
});
