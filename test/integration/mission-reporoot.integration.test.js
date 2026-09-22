// /api/mission resolves the openspec folders against repoRoot, not process.cwd(): relative to the
// working folder, it would fail (ENOENT) whenever the collector was not started from the repo root.
// They derive from repoRoot unless explicitly overridden.
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { startServer } = require('../../server/server');

test('the mission payload resolves openspec dirs from repoRoot, independent of cwd', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'mcroot-'));
  fs.mkdirSync(path.join(repo, 'openspec', 'specs'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'openspec', 'changes', '2026-07-01-guest-address-x', 'specs'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'openspec', 'specs', 'cap.feature'),
    '@implemented\nScenario: a\n@aspirational\nScenario: b\n'
  );
  fs.writeFileSync(
    path.join(repo, 'openspec', 'changes', '2026-07-01-guest-address-x', 'proposal.md'),
    '---\nstatus: draft\n---\n'
  );
  fs.writeFileSync(
    path.join(repo, 'openspec', 'changes', '2026-07-01-guest-address-x', 'specs', 'cap.md'),
    '## ADDED\n'
  );
  // The change edits `cap`, which the repo's Checkout category owns: it is counted under Checkout.
  fs.writeFileSync(
    path.join(repo, 'MISSION.md'),
    '# Shop\n\nCustomers pay.\n\n## Categories\n- Checkout — specs: cap\n'
  );

  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcroot-logs-'));
  const srv = await startServer({ port: 0, dbPath: ':memory:', logDir, repoRoot: repo, watchMs: 0 });
  try {
    const res = await request(`http://127.0.0.1:${srv.port}`).get('/api/mission');
    expect(res.status).toBe(200); // not a 500 (ENOENT)
    expect(res.body.totals.total).toBe(2);
    expect(res.body.totals.implemented).toBe(1);
    expect(res.body.activeChanges).toBe(1);
    expect(res.body.changesByLane).toEqual({ Checkout: 1 });
    // git-less fixture repo: velocity degrades to empty instead of 500ing the payload.
    // trailing7d is part of that empty shape on purpose — the hero tile reads it
    // directly, and a missing key would render "undefined" rather than 0.
    expect(res.body.velocity).toEqual({ totalPRs: 0, perWeek: {}, trailing7d: 0 });
  } finally {
    await srv.close();
  }
});
