// The gates feed's format: what a repo's gate runner is running, what waits in the order it will start them,
// its scheduler's state, and how long gates usually take. Every number the page prints or counts with is
// checked, because the page writes it straight into the panel.
const { checkGates } = require('../../../server/panels/gates');

const NOW = Date.parse('2026-09-15T10:00:00.000Z');
const MIN = 60 * 1000;

const running = (o = {}) => ({
  worktree: 'checkout-guest-form',
  branch: 'feat/guest-form',
  sha: 'a1b2c3d',
  granted_at: NOW - 12 * MIN,
  ran_ms: 12 * MIN,
  mode: 'active',
  cores: 4,
  ...o,
});
const waiting = (o = {}) => ({
  position: 1,
  worktree: 'checkout-cart-totals',
  branch: 'fix/cart-totals',
  sha: 'd4e5f6a',
  queued_since: NOW - 5 * MIN,
  waited_ms: 5 * MIN,
  ...o,
});
const HISTORY = { runs: 24, p25: 12, median: 14, p75: 17, p90: 21, window_days: 14 };
const feed = (o = {}) => ({
  format: 1,
  generated_at: NOW,
  running: [running()],
  waiting: [waiting()],
  scheduler: {
    tick_age_ms: 4000,
    mode: 'active',
    blocked: 'concurrency cap reached (1 of 1 in active mode)',
    stalled: false,
  },
  history: HISTORY,
  ...o,
});

test('a full feed passes, and so does a quiet one with nothing but its two lists', () => {
  expect(checkGates(feed())).toEqual([]);
  expect(checkGates({ format: 1, running: [], waiting: [] })).toEqual([]);
  expect(
    checkGates(feed({ history: null, scheduler: { tick_age_ms: null, stalled: null, blocked: null, mode: null } }))
  ).toEqual([]);
  expect(
    checkGates(feed({ running: [{ worktree: 'w', granted_at: NOW }], waiting: [{ position: 1, worktree: 'v' }] }))
  ).toEqual([]);
});

test('running and waiting must be lists: an empty queue is only ever one that was read', () => {
  expect(checkGates({ format: 1 })).toEqual(['"running" must be a list', '"waiting" must be a list']);
  expect(checkGates(feed({ running: {}, waiting: 'none' }))).toEqual([
    '"running" must be a list',
    '"waiting" must be a list',
  ]);
});

test('every problem in a running gate is named', () => {
  expect(
    checkGates(
      feed({
        running: [
          null,
          { granted_at: NOW },
          running({ granted_at: 'noon' }),
          running({ branch: 3, sha: {}, mode: 1 }),
          running({ ran_ms: -1, cores: '4' }),
        ],
      })
    )
  ).toEqual([
    'running[0] must be an object',
    'running[1].worktree must be a name',
    'running[2].granted_at must be a time in milliseconds',
    'running[3].branch must be text',
    'running[3].sha must be text',
    'running[3].mode must be text',
    'running[4].ran_ms must be a number from 0',
    'running[4].cores must be a number from 0',
  ]);
});

test('every problem in a waiting gate is named', () => {
  expect(
    checkGates(
      feed({
        waiting: [
          [],
          waiting({ position: 0, worktree: '' }),
          waiting({ position: 1.5, queued_since: 'yesterday', waited_ms: -3 }),
        ],
      })
    )
  ).toEqual([
    'waiting[0] must be an object',
    'waiting[1].position must be a whole number from 1',
    'waiting[1].worktree must be a name',
    'waiting[2].position must be a whole number from 1',
    'waiting[2].queued_since must be a time in milliseconds',
    'waiting[2].waited_ms must be a number from 0',
  ]);
});

test('the scheduler, when given, is an object whose fields have their types', () => {
  expect(checkGates(feed({ scheduler: 'ok' }))).toEqual(['"scheduler" must be an object']);
  expect(checkGates(feed({ scheduler: { tick_age_ms: -5, stalled: 'no', blocked: 7, mode: [] } }))).toEqual([
    'scheduler.tick_age_ms must be a number from 0',
    'scheduler.stalled must be true or false',
    'scheduler.blocked must be text',
    'scheduler.mode must be text',
  ]);
});

test('history, when given, has all six figures as numbers', () => {
  expect(checkGates(feed({ history: [] }))).toEqual(['"history" must be an object or null']);
  expect(checkGates(feed({ history: { ...HISTORY, median: '14', window_days: undefined } }))).toEqual([
    'history.median must be a number from 0',
    'history.window_days must be a number from 0',
  ]);
});

test('generated_at, when given, is a time', () => {
  expect(checkGates(feed({ generated_at: 'now' }))).toEqual(['"generated_at" must be a time in milliseconds']);
});
