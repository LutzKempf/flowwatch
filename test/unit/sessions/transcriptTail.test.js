const fs = require('fs');
const os = require('os');
const path = require('path');
const { readTranscriptTail, readTailText } = require('../../../server/sessions/transcriptTail');

const NOW = Date.parse('2026-09-14T12:00:00.000Z');

const write = (lines) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tail-')), 's.jsonl');
  fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return f;
};
const assistant = (ts, blocks, extra = {}) => ({
  type: 'assistant',
  timestamp: ts,
  message: { id: 'm1', role: 'assistant', content: blocks },
  ...extra,
});
const user = (ts, content) => ({ type: 'user', timestamp: ts, message: { role: 'user', content } });

test('a last turn that only speaks is waiting on the operator', () => {
  const f = write([
    user('2026-09-14T11:00:00.000Z', 'go'),
    assistant('2026-09-14T11:05:00.000Z', [{ type: 'text', text: 'First line.\n\nShall I merge it?' }]),
  ]);
  const tail = readTranscriptTail([f], { now: NOW });
  expect(tail.state).toBe('waiting');
  expect(tail.finalText).toContain('Shall I merge it?');
  expect(tail.messageId).toBe('m1');
  expect(tail.pendingQuestion).toBe(false);
});

test('a turn that stopped mid-tool is working while fresh and ended mid-turn once quiet', () => {
  const fresh = write([assistant('2026-09-14T11:50:00.000Z', [{ type: 'tool_use', name: 'Bash', input: {} }])]);
  expect(readTranscriptTail([fresh], { now: NOW }).state).toBe('working');

  const quiet = write([assistant('2026-09-14T10:00:00.000Z', [{ type: 'tool_use', name: 'Bash', input: {} }])]);
  expect(readTranscriptTail([quiet], { now: NOW }).state).toBe('abandoned');
});

test('a pending question is flagged and its text is carried', () => {
  const f = write([
    assistant('2026-09-14T11:30:00.000Z', [
      { type: 'text', text: 'Two ways to do this.' },
      {
        type: 'tool_use',
        name: 'AskUserQuestion',
        input: { questions: [{ question: 'Which one?', options: [{ label: 'A' }, { label: 'B' }] }] },
      },
    ]),
  ]);
  const tail = readTranscriptTail([f], { now: NOW });
  expect(tail.pendingQuestion).toBe(true);
  expect(tail.state).toBe('waiting');
  expect(tail.finalText).toContain('Which one?');
});

test('a prompt after the last reply hands the turn back to the agent', () => {
  const f = write([
    assistant('2026-09-14T11:00:00.000Z', [{ type: 'text', text: 'Done.' }]),
    user('2026-09-14T11:55:00.000Z', 'now do the next one'),
  ]);
  expect(readTranscriptTail([f], { now: NOW }).state).toBe('working');
});

test('an api error on the last turn is carried', () => {
  const f = write([
    assistant('2026-09-14T11:50:00.000Z', [{ type: 'text', text: 'API Error: overloaded' }], {
      isApiErrorMessage: true,
    }),
  ]);
  expect(readTranscriptTail([f], { now: NOW }).apiError).toBe(true);
});

// A long-running session's transcript reaches tens of megabytes and this runs on the collector's
// event loop, so only the end is read. The answer must still be the last turn's.
test('only the end of a long transcript is read, and it still finds the last turn', () => {
  // Every assistant message carries its own id in a real transcript; records sharing an id are one
  // message whose blocks are joined, which would merge the filler into the final answer.
  const filler = [];
  for (let i = 0; i < 500; i++) {
    filler.push({
      type: 'assistant',
      timestamp: '2026-09-14T09:00:00.000Z',
      message: {
        id: 'old-' + i,
        role: 'assistant',
        content: [{ type: 'text', text: 'old line ' + i + ' ' + 'x'.repeat(200) }],
      },
    });
  }
  const f = write([...filler, assistant('2026-09-14T11:40:00.000Z', [{ type: 'text', text: 'The last word.' }])]);
  const full = fs.statSync(f).size;

  const tail = readTranscriptTail([f], { now: NOW, maxBytes: 4096 });
  expect(full).toBeGreaterThan(4096);
  expect(tail.finalText).toBe('The last word.');
  expect(readTailText(f, 4096).length).toBeLessThanOrEqual(4096);
});

test('an unreadable file is skipped rather than thrown', () => {
  expect(readTranscriptTail([path.join(os.tmpdir(), 'no-such-' + Date.now() + '.jsonl')], { now: NOW })).toBeNull();
});

test('an empty transcript has no tail', () => {
  expect(readTranscriptTail([write([user('2026-09-14T11:00:00.000Z', 'go')])], { now: NOW })).toBeNull();
});
