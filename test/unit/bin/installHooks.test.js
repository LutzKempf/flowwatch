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
