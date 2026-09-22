const path = require('path');
const { resolveRepoPath } = require('../../hooks/lib/repoPath');

/**
 * Where the Claude desktop app keeps its session records on this machine: `%APPDATA%\Claude\claude-code-sessions`
 * on Windows, `~/Library/Application Support/Claude/claude-code-sessions` on macOS, and nowhere on Linux, which
 * has no Claude desktop app (the board then runs on the session hooks alone). flowwatch.json
 * "sessions": { "appRecords": "<path>" } overrides it on any platform: relative to the repo, `~` for the home folder.
 * Pure: the caller passes the platform, home folder and environment, so each platform can be pinned anywhere.
 * @param {{platform: string, home: string, env: Object<string, string|undefined>, repoRoot: string, setting?: *}} input
 * @returns {{dir: string|null, looked: string}} `looked` says where it looked, or why there was nowhere to
 */
function appRecordsDir({ platform, home, env, repoRoot, setting }) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const at = (/** @type {string} */ dir) => ({ dir, looked: 'looked in ' + dir });
  if (typeof setting === 'string' && setting.trim()) {
    const dir = resolveRepoPath(repoRoot, setting, home, p);
    return { dir, looked: at(dir).looked + ' (flowwatch.json "sessions.appRecords")' };
  }
  if (platform === 'win32') {
    return env.APPDATA
      ? at(p.join(env.APPDATA, 'Claude', 'claude-code-sessions'))
      : { dir: null, looked: 'APPDATA is not set, so there was nowhere to look' };
  }
  if (platform === 'darwin')
    return at(p.join(home, 'Library', 'Application Support', 'Claude', 'claude-code-sessions'));
  return {
    dir: null,
    looked:
      'there is no Claude desktop app for ' +
      (platform === 'linux' ? 'Linux' : platform) +
      '; "sessions.appRecords" in flowwatch.json can name the folder',
  };
}

module.exports = { appRecordsDir };
