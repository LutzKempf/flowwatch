// A folder named in flowwatch.json is relative to the repo, or to the home folder when it starts with `~`.
// The collector's data folder and the app-records folder both read paths this way.
const os = require('os');
const path = require('path');
const { resolveRepoPath } = require('../../../hooks/lib/repoPath');
const { collectorConfig } = require('../../../hooks/lib/collectorConfig');
const fs = require('fs');

const REPO = path.resolve(os.tmpdir(), 'fw-repo-path');
const HOME = path.resolve(os.tmpdir(), 'fw-home');

test("a relative path is the repo's; an absolute one is itself", () => {
  expect(resolveRepoPath(REPO, 'data/fw', HOME)).toBe(path.join(REPO, 'data', 'fw'));
  expect(resolveRepoPath(REPO, path.join(HOME, 'x'), HOME)).toBe(path.join(HOME, 'x'));
});

test('a leading ~ is the home folder; ~name is an ordinary folder name', () => {
  expect(resolveRepoPath(REPO, '~', HOME)).toBe(HOME);
  expect(resolveRepoPath(REPO, '~/.dev-data', HOME)).toBe(path.join(HOME, '.dev-data'));
  expect(resolveRepoPath(REPO, '~\\.dev-data', HOME)).toBe(path.join(HOME, '.dev-data'));
  expect(resolveRepoPath(REPO, '~other/x', HOME)).toBe(path.join(REPO, '~other', 'x'));
});

test('a path written with backslashes on Windows means the same folders on macOS and Linux', () => {
  expect(resolveRepoPath('/r', '~\\.dev-data', '/h', path.posix)).toBe('/h/.dev-data');
  expect(resolveRepoPath('/r', 'docs\\data', '/h', path.posix)).toBe('/r/docs/data');
  expect(resolveRepoPath('C:\\r', 'docs/data', 'C:\\h', path.win32)).toBe('C:\\r\\docs\\data');
});

test("the collector's data folder accepts ~, so a repo can keep a folder it already has", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-cc-'));
  fs.writeFileSync(path.join(repo, 'flowwatch.json'), '{"collector": {"dataDir": "~/.some-data"}}');
  expect(collectorConfig(repo).dataDir).toBe(path.join(os.homedir(), '.some-data'));
});
