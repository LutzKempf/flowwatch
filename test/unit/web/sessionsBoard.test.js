// The Sessions panel: the board is grouped the way the inbox was, every open conversation
// can be sorted, and a single session can be sent to Cleanup.
const Triage = require('../../../web/lib/triage.js');

const item = (o) => ({ key: 'k-' + o.session_id, session_id: o.session_id, hours_waiting: 1, ...o });

describe('board groups', () => {
  test('a conversation the inbox has no record for is working, not waiting on you', () => {
    expect(Triage.factBucket(item({ session_id: 'a', waiting: false }))).toBe('working');
    // "not waiting" wins over facts that would otherwise file it: it is not in the inbox at all
    expect(Triage.factBucket(item({ session_id: 'b', waiting: false, asks: true }))).toBe('working');
  });

  test('the board renders the inbox groups in their order, then working', () => {
    expect(Triage.BOARD_GROUPS.map((g) => g.id)).toEqual(['stuck', 'answer', 'merge', 'done', 'working']);
    expect(Triage.BOARD_GROUPS.find((g) => g.id === 'working').open).toBe(true);
    expect(Triage.GROUPS.map((g) => g.id)).toEqual(['stuck', 'answer', 'merge', 'done']); // the inbox's own list is unchanged
  });
});

describe('board rows', () => {
  const NOW = Date.parse('2026-09-21T12:00:00Z');
  const sess = (id, o) => ({ id, wt: 'wt-' + id, cur: 5, state: 'work', seen: NOW - 2 * 36e5, ...o });
  const titles = {
    a: {
      title: 'Retro: waits',
      app_session_id: 'app-a',
      category: 'Retro',
      category_from: 'title prefix',
      branch: 'b/a',
    },
    b: {
      title: 'Payments: busy',
      app_session_id: 'app-b',
      category: 'Payments',
      category_from: 'title prefix',
      branch: 'b/b',
    },
  };

  test('every open conversation is one row: the inbox item joined to its board session, then the board sessions the inbox has not got', () => {
    const inbox = [item({ session_id: 'app-a' }), item({ session_id: 'app-x' })];
    const sessions = [sess('a'), sess('b'), sess('part-0')]; // part-0: an earlier part, no title of its own
    const out = Triage.boardItems({ inbox, sessions, titles, now: NOW });
    expect(out.map((r) => [r.item.session_id, r.si])).toEqual([
      ['app-a', 0],
      ['app-x', -1],
      ['app-b', 1],
    ]);
    expect(out[0].item).toBe(inbox[0]); // an inbox item is kept as the inbox sent it
    expect(out[2].item).toMatchObject({
      waiting: false,
      key: 'board:app-b',
      title: 'Payments: busy',
      category: 'Payments',
      category_from: 'title prefix',
      branch: 'b/b',
      worktree: 'wt-b',
      phase: 5,
      state: 'working',
      hours_waiting: 2,
    });
  });

  test('before the titles load, each board session stands alone under its folder', () => {
    const out = Triage.boardItems({
      inbox: [item({ session_id: 'app-a' })],
      sessions: [sess('a')],
      titles: null,
      now: NOW,
    });
    expect(out.map((r) => [r.item.session_id, r.item.title, r.si])).toEqual([
      ['app-a', undefined, -1],
      [null, 'wt-a', 0],
    ]);
  });

  // The board archives a session only after 7 quiet days, so one the operator archived in the app can still
  // be on it. Closed in the app is not open, and not working.
  test('a conversation archived in the app is not a row, even while the board still has it', () => {
    const t = { ...titles, c: { title: 'Retro: closed', app_session_id: 'app-c', app_archived: true } };
    const out = Triage.boardItems({ inbox: [], sessions: [sess('b'), sess('c')], titles: t, now: NOW });
    expect(out.map((r) => r.item.session_id)).toEqual(['app-b']);
  });

  // No cap: the board has to list every open conversation, and a cap would hide rows.
  test('no row is dropped, however many sessions are open', () => {
    const sessions = Array.from({ length: 40 }, (_, i) => sess('s' + i));
    const t = Object.fromEntries(sessions.map((s) => [s.id, { title: s.id, app_session_id: 'app-' + s.id }]));
    expect(Triage.boardItems({ inbox: [], sessions, titles: t, now: NOW })).toHaveLength(40);
  });

  test('a board row is never "new since you sorted": the flag is about a waiting session\'s message', () => {
    const [{ item: busy }] = Triage.boardItems({ inbox: [], sessions: [sess('b')], titles, now: NOW });
    const sorting = Triage.applySorting(
      {},
      { ...busy, key: 'an-older-message' },
      { focus: true },
      '2026-09-21T10:00:00Z'
    );
    const [row] = Triage.rowsFrom([busy], sorting);
    expect([row.bucket, row.focus, row.newSinceSorted]).toEqual(['working', true, false]);
  });
});

describe('per-session Cleanup', () => {
  const at = '2026-09-21T10:00:00Z';

  test('Cleanup is a row flag the operator sets, stored with High focus and the category', () => {
    const it = item({ session_id: 's1' });
    let sorting = Triage.applySorting({}, it, { cleanup: true }, at);
    expect(sorting.s1).toMatchObject({ cleanup: true, sortedKey: 'k-s1' });
    expect(Triage.rowsFrom([it], sorting)[0].cleanup).toBe(true);
    sorting = Triage.applySorting(sorting, it, { focus: true }, at);
    expect(sorting.s1).toMatchObject({ cleanup: true, focus: true });
  });

  test('taking the flag off leaves no empty entry behind', () => {
    const it = item({ session_id: 's1' });
    const flagged = Triage.applySorting({}, it, { cleanup: true }, at);
    expect(Triage.applySorting(flagged, it, { cleanup: false }, at)).toEqual({});
    expect(Triage.rowsFrom([it], {})[0].cleanup).toBe(false);
  });

  const rowsOf = (sorting) =>
    Triage.rowsFrom(
      [
        item({ session_id: 'r', category: 'Retro', hours_waiting: 5 }),
        item({ session_id: 'c', category: 'Payments', hours_waiting: 9 }),
        item({ session_id: 's', category: 'Reporting', hours_waiting: 2 }),
      ],
      sorting
    );
  const ids = (out) => out.sessions.map((r) => r.item.session_id);

  test('a flagged session is listed in Cleanup although its category is shown', () => {
    const sorting = Triage.applySorting({}, item({ session_id: 's' }), { cleanup: true }, at);
    const out = Triage.cleanupItems({ rows: rowsOf(sorting), lanes: [], hidden: new Set(['Retro']) });
    expect(ids(out)).toEqual(['r', 's']); // the hidden category's session and the flagged one, longest-waiting first
  });

  test('with nothing hidden, flagged sessions are all Cleanup lists — not everything', () => {
    const sorting = Triage.applySorting({}, item({ session_id: 's' }), { cleanup: true }, at);
    expect(ids(Triage.cleanupItems({ rows: rowsOf(sorting), lanes: [], hidden: new Set() }))).toEqual(['s']);
  });

  test('with nothing hidden and nothing flagged, Cleanup lists everything', () => {
    expect(ids(Triage.cleanupItems({ rows: rowsOf({}), lanes: [], hidden: new Set() }))).toEqual(['c', 'r', 's']);
  });
});
