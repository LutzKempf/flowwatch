const os = require('os');
const path = require('path');

/**
 * A folder named in flowwatch.json: relative to the repo, or to the home folder when it starts with `~`
 * (`~` alone, `~/…` or `~\…`; `~name` is an ordinary folder name). The file is committed and read on every
 * platform, so a backslash is a separator everywhere, not a character of a folder name.
 * @param {string} repoRoot the repo the setting belongs to
 * @param {string} setting the path as written
 * @param {string} [home] the home folder (tests pass their own)
 * @param {typeof path} [pathApi] path.win32 or path.posix to resolve as that platform does; this machine's by default
 * @returns {string} an absolute path
 */
function resolveRepoPath(repoRoot, setting, home = os.homedir(), pathApi = path) {
  const written = pathApi.sep === '/' ? setting.trim().replace(/\\/g, '/') : setting.trim();
  return pathApi.resolve(repoRoot, written.replace(/^~(?=$|[\\/])/, home));
}

module.exports = { resolveRepoPath };
