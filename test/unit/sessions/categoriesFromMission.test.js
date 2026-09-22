// The session categories are the repo's own, from its MISSION.md: none are written into the code, so no
// repo is offered another repo's lanes.
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { openDb } = require('../../../server/db');
const { createApp } = require('../../../server/collector');

function repoWith(missionText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cats-'));
  const repoRoot = path.join(root, 'repo');
  const appDir = path.join(root, 'app');
  const tx = path.join(root, 'projects', 'p');
  for (const d of [repoRoot, appDir, tx]) fs.mkdirSync(d, { recursive: true });
  if (missionText) fs.writeFileSync(path.join(repoRoot, 'MISSION.md'), missionText);
  fs.writeFileSync(
    path.join(appDir, 'local_1.json'),
    JSON.stringify({
      sessionId: 'local_1',
      cliSessionId: 'cli-1',
      cwd: repoRoot,
      title: 'Billing: fix the invoice total',
      lastActivityAt: Date.now(),
    })
  );
  fs.writeFileSync(
    path.join(tx, 'cli-1.jsonl'),
    JSON.stringify({
      type: 'assistant',
      timestamp: new Date().toISOString(),
      message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'Done. Merge it?' }] },
    }) + '\n'
  );
  return createApp(openDb(':memory:'), {
    repoRoot,
    inbox: { appDir, projectsDir: path.join(root, 'projects'), repoRoot, ttlMs: 0 },
  });
}

test('a title prefix names a category only when MISSION.md lists it, and the page gets the list with the rows', async () => {
  const res = await request(repoWith('# Ship it\n\nPeople pay.\n\n## Categories\nBilling, Search\n'))
    .get('/api/inbox')
    .expect(200);
  expect(res.body.categories).toEqual(['Billing', 'Search']);
  expect(res.body.items[0]).toMatchObject({ category: 'Billing', category_from: 'title prefix' });
});

test("with no categories, sessions are uncategorised and the list is empty, not another repo's", async () => {
  const res = await request(repoWith('# Ship it\n\nPeople pay.\n')).get('/api/inbox').expect(200);
  expect(res.body.categories).toEqual([]);
  expect(res.body.items[0]).toMatchObject({ category: null, category_from: null });
});
