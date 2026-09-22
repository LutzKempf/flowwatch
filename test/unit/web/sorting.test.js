const { rowsFrom, applySorting, byNewest, byEarliestPhase } = require('../../../web/lib/triage');

const item = (over = {}) => ({
  key: 'm1',
  session_id: 'local_1',
  title: 'Retro: something',
  state: 'waiting',
  category: 'Retro',
  category_from: 'title prefix',
  phase: 5,
  hours_waiting: 3,
  pending_question: false,
  asks: false,
  api_error: false,
  pr: { status: 'none', numbers: [] },
  ...over,
});

test('the category is the endpoint`s until the operator sets one', () => {
  const [plain] = rowsFrom([item()], {});
  expect(plain.category).toBe('Retro');
  expect(plain.categoryFrom).toBe('title prefix');
  expect(plain.manualCategory).toBe(false);

  const [mine] = rowsFrom([item()], { local_1: { category: 'Reporting', sortedKey: 'm1' } });
  expect(mine.category).toBe('Reporting');
  expect(mine.manualCategory).toBe(true);
  expect(mine.categoryFrom).toBe('set by you');
});

test('an operator can say a session has no category at all', () => {
  const [row] = rowsFrom([item()], { local_1: { category: '', sortedKey: 'm1' } });
  expect(row.category).toBe('');
  expect(row.manualCategory).toBe(true);
});

test('a session the endpoint could not categorise has none', () => {
  const [row] = rowsFrom([item({ category: null, category_from: null })], {});
  expect(row.category).toBeNull();
  expect(row.manualCategory).toBe(false);
});

test('High focus is a row flag the operator sets', () => {
  const [off] = rowsFrom([item()], {});
  expect(off.focus).toBe(false);
  const [on] = rowsFrom([item()], { local_1: { focus: true, sortedKey: 'm1' } });
  expect(on.focus).toBe(true);
});

// Nothing the operator sorted is ever cleared for them: the row says the session spoke again.
test('a sorting made before the session spoke again is marked for re-check', () => {
  const sorting = { local_1: { focus: true, sortedKey: 'older-message' } };
  const [stale] = rowsFrom([item({ key: 'newer-message' })], sorting);
  expect(stale.newSinceSorted).toBe(true);
  expect(stale.focus).toBe(true);

  const [fresh] = rowsFrom([item({ key: 'older-message' })], sorting);
  expect(fresh.newSinceSorted).toBe(false);
});

test('applying a sorting keeps the other one and is a new object', () => {
  const before = { local_1: { focus: true, sortedKey: 'm1', at: 'then' } };
  const after = applySorting(before, item(), { category: 'Billing' }, 'now');
  expect(after).not.toBe(before);
  expect(before.local_1.category).toBeUndefined();
  expect(after.local_1).toMatchObject({ focus: true, category: 'Billing', sortedKey: 'm1', at: 'now' });
});

test('a sorting with nothing left in it is removed', () => {
  const before = { local_1: { focus: true, sortedKey: 'm1' } };
  const after = applySorting(before, item(), { focus: false }, 'now');
  expect(after.local_1).toBeUndefined();
});

test('back to automatic clears only the operator`s category', () => {
  const before = { local_1: { focus: true, category: 'Billing', sortedKey: 'm1' } };
  const after = applySorting(before, item(), { category: undefined }, 'now');
  expect(after.local_1).toMatchObject({ focus: true });
  expect('category' in after.local_1).toBe(false);
});

test('inside a group the newest sits first', () => {
  const rows = rowsFrom([item({ key: 'a', hours_waiting: 40 }), item({ key: 'b', hours_waiting: 2 })], {});
  expect([...rows].sort(byNewest).map((r) => r.item.key)).toEqual(['b', 'a']);
});

// High focus is for work that needs thought, so it leads with the earliest stage; a session the
// board has no phase for cannot claim a place in that order and goes last.
test('High focus leads with the earliest phase, and an unknown phase goes last', () => {
  const rows = rowsFrom(
    [
      item({ key: 'late', phase: 9, hours_waiting: 1 }),
      item({ key: 'early', phase: 2, hours_waiting: 1 }),
      item({ key: 'unknown', phase: null, hours_waiting: 1 }),
    ],
    {}
  );
  expect([...rows].sort(byEarliestPhase).map((r) => r.item.key)).toEqual(['early', 'late', 'unknown']);
});

test('two rows at the same phase put the longer wait first', () => {
  const rows = rowsFrom(
    [item({ key: 'short', phase: 4, hours_waiting: 2 }), item({ key: 'long', phase: 4, hours_waiting: 30 })],
    {}
  );
  expect([...rows].sort(byEarliestPhase).map((r) => r.item.key)).toEqual(['long', 'short']);
});
