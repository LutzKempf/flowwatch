// The backfill parser emits file_change and commit, as the live hook mapper
// (hooks/lib/mapHookEvent.js) does. With only user_prompt, bash, skill, token_usage
// and turn_stop, OpenSpec, Plan and Execute would be structurally unreachable for
// every backfilled session, whatever the operator actually did.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseTranscript } = require('../../../server/sessions/transcriptParse');

function writeTranscript(records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tparse-'));
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}

function assistantWith(blocks, timestamp = '2026-07-03T08:00:00.000Z') {
  return { type: 'assistant', timestamp, message: { content: blocks } };
}

function parse(blocks) {
  return parseTranscript(writeTranscript([assistantWith(blocks)]), {
    session_id: 's1',
    worktree: 'wt-a',
  });
}

describe('file_change events', () => {
  test('a Write to tasks.md becomes a file_change carrying the path', () => {
    const evs = parse([{ type: 'tool_use', name: 'Write', input: { file_path: '/r/docs/x/tasks.md' } }]);
    expect(evs.find((e) => e.type === 'file_change')).toMatchObject({ path: '/r/docs/x/tasks.md' });
  });

  test('an Edit under openspec/changes becomes a file_change', () => {
    const evs = parse([
      { type: 'tool_use', name: 'Edit', input: { file_path: '/r/openspec/changes/2026-07-03-x/proposal.md' } },
    ]);
    expect(evs.find((e) => e.type === 'file_change')).toBeDefined();
  });

  test('Windows backslash paths are normalized like the live mapper does', () => {
    const evs = parse([
      { type: 'tool_use', name: 'Write', input: { file_path: 'C:\\r\\openspec\\changes\\x\\proposal.md' } },
    ]);
    expect(evs.find((e) => e.type === 'file_change').path).toBe('C:/r/openspec/changes/x/proposal.md');
  });

  test('an unrelated file write is not a phase signal', () => {
    const evs = parse([{ type: 'tool_use', name: 'Write', input: { file_path: '/r/server/src/thing.js' } }]);
    expect(evs.find((e) => e.type === 'file_change')).toBeUndefined();
  });
});

describe('commit events', () => {
  test('a git commit bash call also emits a commit event', () => {
    const evs = parse([{ type: 'tool_use', name: 'Bash', input: { command: 'git commit -F msg.txt' } }]);
    expect(evs.find((e) => e.type === 'commit')).toBeDefined();
  });

  test('the bash event is still emitted alongside it', () => {
    const evs = parse([{ type: 'tool_use', name: 'Bash', input: { command: 'git commit -F msg.txt' } }]);
    expect(evs.find((e) => e.type === 'bash')).toMatchObject({ command: 'git commit -F msg.txt' });
  });

  test('a backfilled commit leaves touchesCode unresolved, never a false', () => {
    // A historical commit has no git context to interrogate. Claiming false here
    // would keep a session that wrote code out of Execute.
    const ev = parse([{ type: 'tool_use', name: 'Bash', input: { command: 'git commit -m x' } }]).find(
      (e) => e.type === 'commit'
    );
    expect(ev.touchesCode).toBeNull();
  });

  test('a non-commit bash call emits no commit event', () => {
    const evs = parse([{ type: 'tool_use', name: 'Bash', input: { command: 'git status' } }]);
    expect(evs.find((e) => e.type === 'commit')).toBeUndefined();
  });
});

test('the five original event kinds are unaffected', () => {
  const file = writeTranscript([
    { type: 'user', userType: 'external', timestamp: '2026-07-03T08:00:00.000Z', message: { content: 'go' } },
    assistantWith(
      [{ type: 'tool_use', name: 'Skill', input: { skill: 'superpowers:brainstorming' } }],
      '2026-07-03T08:00:01.000Z'
    ),
  ]);
  const types = parseTranscript(file, { session_id: 's1', worktree: 'wt-a' }).map((e) => e.type);
  expect(types).toContain('user_prompt');
  expect(types).toContain('skill');
  expect(types).toContain('turn_stop');
});
