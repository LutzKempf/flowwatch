// days=0 opts out of the session age window: these fixtures seed synthetic
// timestamps (ts:1000 and friends), and this suite is asserting ingest/replay,
// not which sessions the board chooses to show.
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { startServer } = require('../../server/server');

test('events appended while the collector was down are ingested at next boot, then the log rotates', async () => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-'));
  fs.writeFileSync(
    path.join(logDir, 'w1.log.jsonl'),
    JSON.stringify({ id: 'off1', session_id: 'sOff', worktree: 'w1', ts: 1000, type: 'session_start' }) + '\n'
  );

  const srv = await startServer({ port: 0, dbPath: ':memory:', logDir });
  const res = await request(`http://127.0.0.1:${srv.port}`).get('/api/pipeline?days=0');
  expect(res.body.sessions.find((s) => s.id === 'sOff')).toBeTruthy();
  expect(fs.existsSync(path.join(logDir, 'w1.log.jsonl'))).toBe(false); // rotated…
  expect(fs.existsSync(path.join(logDir, 'w1.log.jsonl.replayed'))).toBe(true); // …not deleted
  await srv.close();
});
