// Plan was the phase a session was almost never seen in: 3 of the 428 sessions that got past it on the board that
// exposed this. Its one signal was a file named tasks.md, and the common place for a plan -- a markdown file in a
// plans/ folder, where the superpowers writing-plans skill puts one -- was not a signal at all. Worse, the live hook
// and the transcript reader dropped such a write before anything could look at it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { phaseForEvent } = require('../../../server/sessions/phaseDetector');
const { PHASE } = require('../../../server/sessions/phases');
const { mapHookEvent } = require('../../../hooks/lib/mapHookEvent');
const { parseTranscript } = require('../../../server/sessions/transcriptParse');

// A Windows path, as the hooks see one there: the rule must hold for either separator.
const PLAN = ['C:', 'repo', 'docs', 'superpowers', 'plans', '2026-09-21-flowwatch.md'].join(String.fromCharCode(92));

test('a markdown file in a plans/ folder is the Plan phase', () => {
  expect(phaseForEvent({ type: 'file_change', path: PLAN })).toBe(PHASE.PLAN);
  expect(phaseForEvent({ type: 'file_change', path: '/r/docs/plans/next.md' })).toBe(PHASE.PLAN);
  expect(phaseForEvent({ type: 'file_change', path: '/r/openspec/changes/x/tasks.md' })).toBe(PHASE.PLAN);
});

test('and nothing merely near one is', () => {
  for (const p of ['/r/docs/plans.md', '/r/src/plans/route.js', '/r/docs/superpowers/specs/x.md', '/r/README.md'])
    expect(phaseForEvent({ type: 'file_change', path: p })).toBeNull();
});

test('the live hook reports a write to a plan', () => {
  const [ev] = mapHookEvent({
    session_id: 's1',
    cwd: '/r',
    hook_event_name: 'PostToolUse',
    tool_name: 'Write',
    tool_input: { file_path: PLAN },
  });
  expect(ev && phaseForEvent(ev)).toBe(PHASE.PLAN);
});

test('the transcript reader reports a write to a plan', () => {
  const rec = {
    type: 'assistant',
    timestamp: '2026-09-21T08:00:00.000Z',
    message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: PLAN, content: '# Plan' } }] },
  };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'plan-')), 't.jsonl');
  fs.writeFileSync(file, JSON.stringify(rec) + '\n');
  const events = parseTranscript(file, { session_id: 's1', worktree: 'w' });
  expect(events.map(phaseForEvent)).toContain(PHASE.PLAN);
});
