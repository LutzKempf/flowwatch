const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseChanges } = require('../../../server/repo/changesParser');
const { ownerTable } = require('../../../server/sessions/capabilityLane');

// One active change, the saved-cards trial: it edits checkout-flow and payment-methods (its specs/*.md deltas).
const FIXTURE = path.join(__dirname, '../../fixtures/changes');

test("parseChanges excludes archive/, and reads each change's status and the capabilities it edits", () => {
  const out = parseChanges(FIXTURE);
  expect(out.active).toHaveLength(1);
  expect(out.active[0]).toMatchObject({
    topic: '2026-07-01-saved-cards-trial',
    status: 'draft',
    capabilities: ['checkout-flow', 'payment-methods'],
  });
  expect(out.archivedCount).toBe(1);
});

// A change's lane is the category MISSION.md says owns what it edits, by the same lookup as a spec's lane.
test('a change is counted under the category owning the capabilities it edits', () => {
  const out = parseChanges(FIXTURE, { table: ownerTable({ Payments: ['payment-*'] }) });
  expect(out.active[0].lane).toBe('Payments');
  expect(out.byLane).toEqual({ Payments: 1 });
});

// Counted once, so the counts add up to the number of changes; by capability name, not by category order.
test('a change editing capabilities of several categories is counted once, under the owner of the first by name', () => {
  const out = parseChanges(FIXTURE, { table: ownerTable({ Payments: ['payment-*'], Checkout: ['checkout-flow'] }) });
  expect(out.active[0].lane).toBe('Checkout');
  expect(out.byLane).toEqual({ Checkout: 1 });
});

test('a change editing no capability a category owns falls back to the inference, then to other', () => {
  const inferCategory = (c) => (/payment/.test(c) ? 'Payments' : null);
  expect(parseChanges(FIXTURE, { table: ownerTable({ Reporting: ['sales-report'] }), inferCategory }).byLane).toEqual({
    Payments: 1,
  });
  expect(parseChanges(FIXTURE, { table: ownerTable({ Reporting: ['sales-report'] }) }).byLane).toEqual({ other: 1 });
  expect(parseChanges(FIXTURE).byLane).toEqual({ other: 1 });
});

test('a change with no spec deltas edits nothing and is other, whatever its folder is called', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'changes-'));
  fs.mkdirSync(path.join(dir, '2026-09-01-checkout-copy'));
  const out = parseChanges(dir, { table: ownerTable({ Checkout: ['checkout-*'] }) });
  expect(out.active).toEqual([
    { topic: '2026-09-01-checkout-copy', lane: 'other', status: 'proposed', capabilities: [] },
  ]);
});
