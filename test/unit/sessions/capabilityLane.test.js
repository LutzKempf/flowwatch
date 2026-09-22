const fs = require('fs');
const path = require('path');
const { parseMission } = require('../../../server/repo/missionFile');
const { ownerTable, capabilityLane } = require('../../../server/sessions/capabilityLane');

const FIXTURE = path.join(__dirname, '..', '..', 'fixtures', 'repo');
// A made-up repo's MISSION.md: its Categories section says which category owns which specs.
const OWNERS = parseMission(fs.readFileSync(path.join(FIXTURE, 'MISSION.md'), 'utf8')).categorySpecs;
// The same repo's own category inference (its flowwatch.json "sessions.categorize"): the first pattern that
// matches wins, the way a real one misfiles a capability MISSION.md places elsewhere.
const { inferCategory } = require(path.join(FIXTURE, 'scripts', 'categorize.js'));

// The inference and Checkout's `cart-*` prefix both file cart-analytics under Checkout. Reporting owns the
// exact name, and the exact name wins.
test('the owners MISSION.md names decide before any inference, exact names before prefixes', () => {
  const table = ownerTable(OWNERS);
  expect(inferCategory('cart-analytics')).toBe('Checkout');
  expect(capabilityLane('cart-analytics', { table, inferCategory })).toEqual({ lane: 'Reporting', from: 'categories' });
  expect(capabilityLane('cart-totals', { table, inferCategory })).toEqual({ lane: 'Checkout', from: 'categories' });
  expect(capabilityLane('payment-refunds', { table, inferCategory })).toEqual({ lane: 'Payments', from: 'categories' });
});

test('a capability no category owns falls back to inference, and says so', () => {
  const table = ownerTable(OWNERS);
  expect(capabilityLane('receipt-emails', { table, inferCategory })).toEqual({
    lane: 'Notifications',
    from: 'inferred',
  });
  expect(capabilityLane('release-notes', { table, inferCategory })).toEqual({ lane: null, from: null });
});

test('categories that own nothing give an empty table, so the caller can report inference-only', () => {
  const table = ownerTable(parseMission('# T\n\nS.\n\n## Categories\nCheckout, Reporting\n').categorySpecs);
  expect(table.exact.size).toBe(0);
  expect(table.prefixes).toEqual([]);
  expect(capabilityLane('cart-analytics', { table, inferCategory })).toEqual({ lane: 'Checkout', from: 'inferred' });
});
