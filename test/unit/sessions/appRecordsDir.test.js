// Where the Claude desktop app keeps its session records, per platform — pinned with an injected platform, home
// and environment, never the machine the tests run on. flowwatch.json "sessions": { "appRecords": "<path>" }
// overrides it anywhere. Linux has no Claude desktop app: the board then runs on the session hooks alone.
const path = require('path');
const { appRecordsDir } = require('../../../server/sessions/appRecordsDir');

test('Windows: the Claude folder in %APPDATA%', () => {
  expect(
    appRecordsDir({
      platform: 'win32',
      home: 'D:\\ann',
      env: { APPDATA: 'D:\\Profiles\\ann\\Roaming' },
      repoRoot: 'C:\\shop',
    })
  ).toEqual({
    dir: 'D:\\Profiles\\ann\\Roaming\\Claude\\claude-code-sessions',
    looked: 'looked in D:\\Profiles\\ann\\Roaming\\Claude\\claude-code-sessions',
  });
});

test('Windows with no %APPDATA%: nowhere to look, and it says so', () => {
  expect(appRecordsDir({ platform: 'win32', home: 'D:\\ann', env: {}, repoRoot: 'C:\\shop' })).toEqual({
    dir: null,
    looked: 'APPDATA is not set, so there was nowhere to look',
  });
});

test('macOS: Application Support in the home folder', () => {
  expect(
    appRecordsDir({ platform: 'darwin', home: '/u/ann', env: { APPDATA: '/ignored' }, repoRoot: '/u/ann/shop' })
  ).toEqual({
    dir: '/u/ann/Library/Application Support/Claude/claude-code-sessions',
    looked: 'looked in /u/ann/Library/Application Support/Claude/claude-code-sessions',
  });
});

test('Linux: there is no Claude desktop app, so no folder', () => {
  expect(appRecordsDir({ platform: 'linux', home: '/u/ann', env: {}, repoRoot: '/u/ann/shop' })).toEqual({
    dir: null,
    looked: 'there is no Claude desktop app for Linux; "sessions.appRecords" in flowwatch.json can name the folder',
  });
});

describe('"sessions.appRecords" overrides the platform on every platform', () => {
  const said = (dir) => 'looked in ' + dir + ' (flowwatch.json "sessions.appRecords")';
  test('an absolute path is used as it is', () => {
    expect(
      appRecordsDir({
        platform: 'linux',
        home: '/u/ann',
        env: {},
        repoRoot: '/u/ann/shop',
        setting: '/mnt/claude/sessions',
      })
    ).toEqual({ dir: '/mnt/claude/sessions', looked: said('/mnt/claude/sessions') });
    expect(
      appRecordsDir({
        platform: 'win32',
        home: 'D:\\ann',
        env: { APPDATA: 'C:\\x' },
        repoRoot: 'C:\\shop',
        setting: 'E:\\claude\\sessions',
      })
    ).toEqual({ dir: 'E:\\claude\\sessions', looked: said('E:\\claude\\sessions') });
  });

  test("a relative path is the repo's, and ~ is the home folder", () => {
    expect(
      appRecordsDir({
        platform: 'darwin',
        home: '/u/ann',
        env: {},
        repoRoot: '/u/ann/shop',
        setting: 'records',
      }).dir
    ).toBe('/u/ann/shop/records');
    expect(
      appRecordsDir({
        platform: 'darwin',
        home: '/u/ann',
        env: {},
        repoRoot: '/u/ann/shop',
        setting: '~/claude/sessions',
      }).dir
    ).toBe('/u/ann/claude/sessions');
    expect(
      appRecordsDir({ platform: 'win32', home: 'D:\\ann', env: {}, repoRoot: 'C:\\shop', setting: '~\\claude' }).dir
    ).toBe('D:\\ann\\claude');
  });

  test('a setting that is not a path is ignored, not guessed at', () => {
    expect(
      appRecordsDir({ platform: 'darwin', home: '/u/ann', env: {}, repoRoot: '/u/ann/shop', setting: 42 }).dir
    ).toBe(path.posix.join('/u/ann', 'Library', 'Application Support', 'Claude', 'claude-code-sessions'));
  });
});
