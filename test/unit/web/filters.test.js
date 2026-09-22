const { offeredIn, pickFor, dropUnofferedPicks } = require('../../../web/lib/triage');

const hidden = (...cats) => new Set(cats);

test('the inbox offers every category that is not hidden', () => {
  expect(offeredIn('Retro', hidden())).toBe(true);
  expect(offeredIn('Retro', hidden('Retro'))).toBe(false);
});

test('no category picked means every offered category shows', () => {
  const picked = pickFor(new Set(), hidden());
  expect(picked('Retro')).toBe(true);
  expect(picked(null)).toBe(true);
});

test('a pick narrows the list to the picked categories', () => {
  const picked = pickFor(new Set(['Retro', 'Reporting']), hidden());
  expect(picked('Retro')).toBe(true);
  expect(picked('Billing')).toBe(false);
});

// A pick that is no longer offered would filter rows away with nothing on screen to explain it.
test('a pick that is no longer offered is ignored rather than hiding everything', () => {
  const picked = pickFor(new Set(['Retro']), hidden('Retro'));
  expect(picked('Billing')).toBe(true);
  expect(picked('Reporting')).toBe(true);
});

test('hiding a picked category drops it from the picks', () => {
  const picks = dropUnofferedPicks(new Set(['Retro', 'Billing']), hidden('Retro'));
  expect([...picks]).toEqual(['Billing']);
});

test('dropping picks leaves the caller`s set alone', () => {
  const before = new Set(['Retro']);
  const after = dropUnofferedPicks(before, hidden('Retro'));
  expect([...before]).toEqual(['Retro']);
  expect([...after]).toEqual([]);
});

test('a session with no category can be picked like any other', () => {
  expect(offeredIn(null, hidden())).toBe(true);
  expect(offeredIn(null, hidden(null))).toBe(false);
  const picked = pickFor(new Set([null]), hidden());
  expect(picked(null)).toBe(true);
  expect(picked('Retro')).toBe(false);
});
