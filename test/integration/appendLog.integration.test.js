const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../../server/db');
const { ingestLogFile } = require('../../server/appendLog');

test('ingests a JSONL append-log, skips blank/corrupt lines, dedupes by id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devpipe-'));
  const log = path.join(dir, 'w1.log.jsonl');
  fs.writeFileSync(
    log,
    [
      JSON.stringify({ id: 'e1', session_id: 's1', ts: 1, type: 'session_start' }),
      '', // blank
      '{ not json', // corrupt
      JSON.stringify({ id: 'e1', session_id: 's1', ts: 1, type: 'session_start' }), // dup
      JSON.stringify({ id: 'e2', session_id: 's1', ts: 2, type: 'bash', command: 'gh pr create' }),
    ].join('\n')
  );

  const db = openDb(':memory:');
  const n = ingestLogFile(db, log);
  expect(n).toBe(2); // two unique valid events
  expect(db.prepare('SELECT current_phase FROM sessions WHERE id=?').get('s1').current_phase).toBe(7);
  db.close();
});
