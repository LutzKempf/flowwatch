// A turn that asks the operator something does not end: Claude Code fires no Stop while a question or a permission
// prompt waits, so the dashboard counted the wait as the agent's work -- one night of it, 864 minutes, on the board
// that exposed this. A probe on 2026-09-25 recorded what Claude Code does send while a question waits: PreToolUse for
// AskUserQuestion, then a Notification of type permission_prompt 6 s later, then PostToolUse when the operator
// answered, 3 h 49 min after. Those payloads, as recorded, are the fixtures here.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mapHookEvent } = require('../../../hooks/lib/mapHookEvent');
const { parseTranscript } = require('../../../server/sessions/transcriptParse');
const { stateForEvents } = require('../../../server/sessionState');

const base = { session_id: 's1', cwd: '/r/.claude/worktrees/wt' };
const types = (payload) => mapHookEvent({ ...base, ...payload }).map((e) => e.type);

test('a question to the operator is a wait; their answer ends it', () => {
  expect(types({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [] } })).toEqual(
    ['waiting']
  );
  expect(types({ hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_input: {} })).toEqual(['answered']);
});

test('a notification that the agent needs the operator is a wait; the others are not', () => {
  const note = (notification_type) => types({ hook_event_name: 'Notification', notification_type, message: 'm' });
  for (const t of ['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input'])
    expect(note(t)).toEqual(['waiting']);
  for (const t of ['idle_prompt', 'auth_success', 'agent_completed', 'elicitation_complete', undefined])
    expect(note(t)).toEqual([]);
});

test('the transcript reader sees the same question and answer', () => {
  const at = (s) => `2026-09-25T06:00:${s}.000Z`;
  const recs = [
    { type: 'user', timestamp: at('00'), message: { role: 'user', content: 'go' } },
    {
      type: 'assistant',
      timestamp: at('08'),
      message: { content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: { questions: [] } }] },
    },
    {
      type: 'user',
      timestamp: at('59'),
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'q1', content: 'Done waiting' }] },
    },
  ];
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wait-')), 't.jsonl');
  fs.writeFileSync(file, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const events = parseTranscript(file, { session_id: 's1', worktree: 'wt' }).filter((e) =>
    ['waiting', 'answered'].includes(e.type)
  );
  expect(events.map((e) => [e.type, new Date(e.ts).toISOString()])).toEqual([
    ['waiting', at('08')],
    ['answered', at('59')],
  ]);
});

test('a session whose last word is a question is waiting on the operator', () => {
  expect(stateForEvents([{ type: 'user_prompt' }, { type: 'waiting' }])).toBe('waiting');
  expect(stateForEvents([{ type: 'waiting' }, { type: 'answered' }])).toBe('working');
});
