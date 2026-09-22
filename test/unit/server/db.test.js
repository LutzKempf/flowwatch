const { openDb } = require('../../../server/db');
test('opens in-memory db with the four tables (incl. meta — one schema owner, not ad-hoc DDL)', () => {
  const db = openDb(':memory:');
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name);
  expect(tables).toEqual(expect.arrayContaining(['sessions', 'events', 'phase_stats', 'meta']));
  db.close();
});
