const path = require('path');
const { parseTranscript, isHumanPrompt } = require('../../../server/sessions/transcriptParse');

test('collapses a multi-message assistant turn into ONE turn_stop at the LAST assistant message', () => {
  // A turn is many assistant messages (tool loops). Emitting turn_stop per
  // message closes the work window at the FIRST response and undercounts work_ms badly.
  const evs = parseTranscript(path.join(__dirname, '../../fixtures/transcript.jsonl'), {
    session_id: 's1',
    worktree: 'w1',
  });
  const stops = evs.filter((e) => e.type === 'turn_stop');
  expect(stops).toHaveLength(1); // ONE stop for the whole turn…
  expect(stops[0].ts).toBe(Date.parse('2026-07-03T08:00:04.000Z')); // …at the LAST assistant msg
  const types = evs.map((e) => e.type);
  expect(types.filter((t) => t === 'user_prompt')).toHaveLength(2); // "go" + "looks good"; tool_result is NOT a prompt
  expect(types).toContain('bash'); // tool_use events survive
});

test('emits token_usage from transcript usage fields so backfilled cost is not zero', () => {
  const evs = parseTranscript(path.join(__dirname, '../../fixtures/transcript.jsonl'), {
    session_id: 's1',
    worktree: 'w1',
  });
  const tok = evs.filter((e) => e.type === 'token_usage');
  expect(tok.length).toBeGreaterThan(0);
  // cumulative: 150 tokens after msg 1, 430 after msg 2 (input+output summed)
  expect(tok[tok.length - 1].tokensTotal).toBe(430);
});

test('a sidechain (subagent) user record is NOT a human prompt', () => {
  const rec = { type: 'user', userType: 'external', message: { content: 'go' } };
  expect(isHumanPrompt(rec)).toBe(true);
  expect(isHumanPrompt({ ...rec, isSidechain: true })).toBe(false);
});

test('unrecognized format is a LOUD skip, not a silent empty result (the version guard)', () => {
  const warnings = [];
  const evs = parseTranscript(path.join(__dirname, '../../fixtures/bad-format.jsonl'), {
    session_id: 's',
    warn: (m) => warnings.push(m),
  });
  expect(evs).toEqual([]);
  expect(warnings.length).toBeGreaterThan(0); // the drift is reported, never swallowed
});
