// A scheduled routine run whose transcript handed the turn back waits for the operator to read and archive
// it, so it is an inbox item, marked as one. Left out of the inbox ("a routine is not waiting on anyone"),
// the board would have no facts for it and file it as "working, not waiting on you".
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../../../server/db');
const { buildInbox } = require('../../../server/sessions/buildInbox');

const NOW = Date.parse('2026-09-21T12:00:00.000Z');
const say = (id, ts, text) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    message: { id, role: 'assistant', content: [{ type: 'text', text }] },
  });
const toolCall = (id, ts) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    message: { id, role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] },
  });

function inboxWith(records) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-'));
  const appDir = path.join(root, 'app');
  const txDir = path.join(root, 'projects', 'C--repo');
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(txDir, { recursive: true });
  for (const { rec, transcript } of records) {
    fs.writeFileSync(path.join(appDir, rec.sessionId + '.json'), JSON.stringify(rec));
    fs.writeFileSync(path.join(txDir, rec.cliSessionId + '.jsonl'), transcript + '\n');
  }
  const db = openDb(':memory:');
  try {
    return buildInbox(db, {
      appDir,
      projectsDir: path.join(root, 'projects'),
      repoRoot: 'C:/repo',
      now: NOW,
      inferCategory: () => 'Retro',
    });
  } finally {
    db.close();
  }
}
const routine = (id, over) => ({
  sessionId: 'local_' + id,
  cliSessionId: 'cli-' + id,
  cwd: 'C:/repo',
  title: 'Daily spec openspec audit',
  scheduledTaskId: 'daily-spec-audit',
  lastActivityAt: NOW - 3600000,
  ...over,
});

test('a routine run that handed the turn back is waiting on you, marked as a routine, with no lane', () => {
  const { items } = inboxWith([
    {
      rec: routine('r1'),
      transcript: say('m-r1', '2026-09-21T11:00:00.000Z', 'Audit done: 2 specs drifted. Fix them?'),
    },
  ]);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    session_id: 'local_r1',
    routine: true,
    state: 'waiting',
    asks: true,
    category: null,
    category_from: null,
  }); // no lane, as in the lanes payload, though inference would say Retro
});

test('a routine run still working, or archived in the app, is not waiting on you', () => {
  const { items } = inboxWith([
    { rec: routine('busy'), transcript: toolCall('m-b', '2026-09-21T11:59:00.000Z') },
    { rec: routine('gone', { isArchived: true }), transcript: say('m-g', '2026-09-21T11:00:00.000Z', 'Done.') },
  ]);
  expect(items).toEqual([]);
});

test('a session that is not a routine says so, and keeps its lane', () => {
  const { items } = inboxWith([
    {
      rec: routine('s1', { scheduledTaskId: undefined, title: 'Fix the gate' }),
      transcript: say('m-s1', '2026-09-21T11:00:00.000Z', 'Done.'),
    },
  ]);
  expect(items[0]).toMatchObject({ routine: false, category: 'Retro', category_from: 'inferred' });
});
