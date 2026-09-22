// Parity pin: the LIVE hook mapper (hooks/lib/mapHookEvent.js) and the BACKFILL transcript parser
// (server/sessions/transcriptParse.js) are two implementations of the same event-mapping rules. This pin
// fails if they drift — e.g. one renames 'bash' or stops recognizing Skill invocations.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mapHookEvent } = require('../../../hooks/lib/mapHookEvent');
const { parseTranscript } = require('../../../server/sessions/transcriptParse');

test('live hook mapping and backfill parsing agree on bash + skill event types', () => {
  const base = { session_id: 's1', cwd: '/r/worktrees/wt-p' };
  const liveBash = mapHookEvent({
    ...base,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'gh pr create --fill' },
  })[0];
  const liveSkill = mapHookEvent({
    ...base,
    hook_event_name: 'PreToolUse',
    tool_name: 'Skill',
    tool_input: { skill: 'brainstorming' },
  })[0];

  // the same two actions as a session transcript records them
  const rec = {
    type: 'assistant',
    timestamp: '2026-07-03T08:00:00.000Z',
    message: {
      content: [
        { type: 'tool_use', name: 'Bash', input: { command: 'gh pr create --fill' } },
        { type: 'tool_use', name: 'Skill', input: { skill: 'brainstorming' } },
      ],
    },
  };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'parity-')), 't.jsonl');
  fs.writeFileSync(file, JSON.stringify(rec) + '\n');
  const bf = parseTranscript(file, { session_id: 's1', worktree: 'wt-p' });

  const bfBash = bf.find((e) => e.type === 'bash');
  const bfSkill = bf.find((e) => e.type === 'skill');
  expect(bfBash).toBeDefined();
  expect(bfSkill).toBeDefined();
  expect(bfBash.type).toBe(liveBash.type); // both 'bash'
  expect(bfBash.command).toBe(liveBash.command); // same command payload field
  expect(bfSkill.type).toBe(liveSkill.type); // both 'skill'
  expect(bfSkill.name).toBe(liveSkill.name); // same name payload field
});

// file_change and commit on both sides: on the live side alone, the backfill could never reach
// OpenSpec, Plan or Execute.
test('live hook mapping and backfill parsing agree on file_change + commit', () => {
  const base = { session_id: 's1', cwd: '/r/worktrees/wt-p' };
  const liveFile = mapHookEvent({
    ...base,
    hook_event_name: 'PostToolUse',
    tool_name: 'Write',
    tool_input: { file_path: '/r/openspec/changes/2026-09-08-x/proposal.md' },
  })[0];
  const liveCommit = mapHookEvent({
    ...base,
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git commit -F msg.txt' },
  })[0];

  const rec = {
    type: 'assistant',
    timestamp: '2026-09-08T08:00:00.000Z',
    message: {
      content: [
        { type: 'tool_use', name: 'Write', input: { file_path: '/r/openspec/changes/2026-09-08-x/proposal.md' } },
        { type: 'tool_use', name: 'Bash', input: { command: 'git commit -F msg.txt' } },
      ],
    },
  };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'parity-')), 't.jsonl');
  fs.writeFileSync(file, JSON.stringify(rec) + '\n');
  const bf = parseTranscript(file, { session_id: 's1', worktree: 'wt-p' });

  const bfFile = bf.find((e) => e.type === 'file_change');
  const bfCommit = bf.find((e) => e.type === 'commit');
  expect(bfFile).toBeDefined();
  expect(bfCommit).toBeDefined();
  expect(bfFile.type).toBe(liveFile.type); // both 'file_change'
  expect(bfFile.path).toBe(liveFile.path); // same normalized path
  expect(bfCommit.type).toBe(liveCommit.type); // both 'commit'
  // Both leave touchesCode unresolved at map time — the live emitter fills it in
  // afterwards from git; the backfill has no HEAD to ask and leaves it null.
  expect(bfCommit.touchesCode).toBeNull();
  expect(liveCommit.touchesCode).toBeNull();
});
