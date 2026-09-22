// days=0 opts out of the session age window: these fixtures seed synthetic
// timestamps (ts:1000 and friends), and this suite is asserting ingest/replay,
// not which sessions the board chooses to show.
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { startServer } = require('../../server/server');

test('server polls the folders flowwatch.json names and surfaces gate_pass in the pipeline', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-'));
  fs.mkdirSync(path.join(root, 'checks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'checks', 'z.json'), JSON.stringify({ session_id: 's9', worktree: 'w', sha: 'z' }));

  fs.writeFileSync(path.join(root, 'flowwatch.json'), JSON.stringify({ pipeline: { passMarkers: 'checks' } }));

  const srv = await startServer({
    port: 0,
    dbPath: ':memory:',
    repoRoot: root,
    watchMs: 50,
    logDir: path.join(root, 'logs'),
  });
  await new Promise((r) => setTimeout(r, 150));
  const res = await request(`http://127.0.0.1:${srv.port}`).get('/api/pipeline?days=0');
  expect(res.body.sessions.find((s) => s.id === 's9').current_phase).toBe(8);
  await srv.close();
});
