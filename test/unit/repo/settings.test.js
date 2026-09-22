// flowwatch.json says where a repo keeps the sources of its optional panels.
// Without it a panel is "not set up", never an empty board that reads as "nothing started"; each panel's
// own state is the feed runner's (test/unit/server/feeds.test.js).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readWiring } = require('../../../server/repo/settings');

const repo = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wiring-'));
const put = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};

describe('finding and reading the file', () => {
  test('none: no file, no error', () => {
    expect(readWiring(repo())).toEqual({ file: null, config: null, error: null });
  });
  test('the repo root first, then docs/', () => {
    const r = repo();
    put(r, 'docs/flowwatch.json', '{"ideas": false}');
    expect(readWiring(r)).toEqual({ file: 'docs/flowwatch.json', config: { ideas: false }, error: null });
    put(r, 'flowwatch.json', '{"stages": false}');
    expect(readWiring(r).file).toBe('flowwatch.json');
  });
  test('not valid JSON: the parse error, never "not set up"', () => {
    const r = repo();
    put(r, 'flowwatch.json', '{ "stages": }');
    const w = readWiring(r);
    expect([w.file, w.config]).toEqual(['flowwatch.json', null]);
    expect(w.error).toMatch(/JSON/);
  });
});
