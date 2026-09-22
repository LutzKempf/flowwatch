const { categoriesOn, cleanupItems } = require('../../../web/lib/triage');

// The repo's categories, as MISSION.md gives them (the inbox payload carries them to the page).
const CATS = ['Checkout', 'Retro'];

// A lane the repo's inference names outside the categories gets a card, so the Categories menu offers it
// too: otherwise that card could never be hidden and its stories could never reach Cleanup.
test('the categories on offer include a lane outside the list, so it can be hidden and cleaned up', () => {
  const lanes = [
    { name: 'Retro', stories: [], older: [] },
    { name: 'Shipping', stories: [], older: [{ topic: 'topic-a', status: 'proposed', days_since_touched: 30 }] },
    { name: null, stories: [], older: [] },
  ];
  expect(categoriesOn(lanes, CATS)).toEqual([...CATS, 'Shipping', '']);
  const hidden = new Set(['Shipping']);
  expect(cleanupItems({ rows: [], lanes, hidden }).stories.map((c) => c.topic)).toEqual(['topic-a']);
});

test('with no lanes payload yet, the categories and No category are on offer', () => {
  expect(categoriesOn(null, CATS)).toEqual([...CATS, '']);
});

test('a repo with no categories offers only No category, plus any lane its work names', () => {
  expect(categoriesOn(null)).toEqual(['']);
  expect(categoriesOn([{ name: 'Retro' }])).toEqual(['Retro', '']);
});
