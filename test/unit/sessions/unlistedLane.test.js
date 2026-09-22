const { buildLanes } = require('../../../server/sessions/buildLanes');

// The repo's inference can file a spec under a lane its categories (MISSION.md) do not list yet. Such a lane
// is placed by placeWork and must survive the lane order too, or its specs and stories leave /api/lanes with
// nothing counting them.
test('a lane the categories do not list still gets its card, after them and before No category', () => {
  const work = new Map([
    [
      'Shipping',
      {
        specs: [{ capability: 'shipping-rates', implemented: 1, total: 3, lane_from: 'inferred' }],
        stories: [],
        older_stories: 0,
        older: [],
      },
    ],
    [
      'Retro',
      {
        specs: [{ capability: 'release-checklist', implemented: 2, total: 2, lane_from: 'categories' }],
        stories: [],
        older_stories: 0,
        older: [],
      },
    ],
    [
      null,
      {
        specs: [{ capability: 'status-page', implemented: 0, total: 1, lane_from: null }],
        stories: [],
        older_stories: 0,
        older: [],
      },
    ],
  ]);
  const out = buildLanes({
    sessions: [],
    records: [],
    inferCategory: () => null,
    work,
    categories: ['Checkout', 'Retro'],
  });
  expect(out.lanes.map((l) => l.name)).toEqual(['Retro', 'Shipping', null]);
  expect(out.lanes[1].specs).toEqual([
    { capability: 'shipping-rates', implemented: 1, total: 3, lane_from: 'inferred' },
  ]);
});

// A repo whose MISSION.md lists no categories still gets every lane its work names, in name order.
test('with no categories at all, every named lane still gets its card', () => {
  const work = new Map([
    ['Retro', { specs: [], stories: [], older_stories: 0, older: [{ topic: 't' }] }],
    ['Billing', { specs: [], stories: [], older_stories: 0, older: [{ topic: 'u' }] }],
  ]);
  expect(buildLanes({ sessions: [], records: [], work }).lanes.map((l) => l.name)).toEqual(['Billing', 'Retro']);
});
