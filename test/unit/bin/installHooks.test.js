// The hook installer writes into a settings file someone else may own: it merges without replacing
// anything, and never overwrites a file it cannot parse.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runInstall, mergeHookSettings } = require('../../../bin/install-hooks');
const fragment = require('../../../templates/hooks.json');

const tmpTarget = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ih-')), 'settings.local.json');

test('existing-but-malformed settings file: loud error, NEVER overwritten', () => {
  const target = tmpTarget();
  const malformed = '{ this is not json';
  fs.writeFileSync(target, malformed);
  expect(() => runInstall(target, { warn: () => {}, log: () => {} })).toThrow(/not valid JSON/);
  expect(fs.readFileSync(target, 'utf8')).toBe(malformed); // byte-identical
});

test('a DIFFERENT existing statusLine is kept — WARN + statusLineKept flag', () => {
  const target = tmpTarget();
  fs.writeFileSync(target, JSON.stringify({ statusLine: { type: 'command', command: 'my-own-statusline' } }));
  const warns = [];
  const res = runInstall(target, { warn: (m) => warns.push(m), log: () => {} });
  expect(res.statusLineKept).toBe(true);
  expect(warns.join('\n')).toContain('existing statusLine kept — Flowwatch token telemetry NOT wired');
  const merged = JSON.parse(fs.readFileSync(target, 'utf8'));
  expect(merged.statusLine.command).toBe('my-own-statusline'); // never replaced
  expect(JSON.stringify(merged.hooks)).toContain('hooks/emit.js'); // hooks still merged
});

test('no existing statusLine: fragment statusLine installed, no WARN', () => {
  const target = tmpTarget();
  const warns = [];
  const res = runInstall(target, { warn: (m) => warns.push(m), log: () => {} });
  expect(res.statusLineKept).toBe(false);
  expect(warns).toEqual([]);
  expect(JSON.parse(fs.readFileSync(target, 'utf8')).statusLine.command).toContain('hooks/statusline.js');
});

test("fragment carries WorktreeRemove so the mapper's worktree_remove (phase 11) branch can fire", () => {
  expect(Object.keys(fragment.hooks)).toContain('WorktreeRemove');
  const merged = mergeHookSettings({}, fragment);
  expect(JSON.stringify(merged.hooks.WorktreeRemove)).toContain('hooks/emit.js');
});

// 1.0.7 added hooks for questions and permission prompts. Running install-hooks again on a repo installed before
// must add exactly those: the merge appends what is missing, so a CHANGED entry (say, AskUserQuestion folded into the
// Bash|PowerShell|Skill matcher) would sit beside the old one and every command would be reported twice.
test('installing over an earlier install adds the question and permission hooks, and changes nothing else', () => {
  // The hooks as v1.0.6 installed them, kept as a fixture: a test must not need the repo's tags, which a CI
  // checkout does not fetch.
  const before = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', 'hooks-v1.0.6.json'), 'utf8'));
  const merged = mergeHookSettings(before, fragment);
  const count = (s) => Object.values(s.hooks).reduce((n, groups) => n + groups.length, 0);
  expect(count(merged)).toBe(count(before) + 3);
  expect(merged.hooks.Notification[0].matcher).toMatch(/permission_prompt/);
  expect(merged.hooks.PreToolUse.map((g) => g.matcher)).toEqual(['Bash|PowerShell|Skill', 'AskUserQuestion']);
  expect(merged.hooks.PostToolUse.map((g) => g.matcher)).toEqual(['Write|Edit|Bash|PowerShell', 'AskUserQuestion']);
});
