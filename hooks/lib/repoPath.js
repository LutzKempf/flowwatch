const os = require('os');
const path = require('path');

/**
 * A folder named in flowwatch.json: relative to the repo, or to the home folder when it starts with `~`
 * (`~` alone, `~/…` or `~\…`; `~name` is an ordinary folder name).
 * @param {string} repoRoot the repo the setting belongs to
 * @param {string} setting the path as written
 * @param {string} [home] the home folder (tests pass their own)
 * @param {typeof path} [pathApi] path.win32 or path.posix to resolve as that platform does; this machine's by default
 * @returns {string} an absolute path
 */
function resolveRepoPath(repoRoot, setting, home = os.homedir(), pathApi = path) {
  return pathApi.resolve(repoRoot, setting.trim().replace(/^~(?=$|[\\/])/, home));
}

module.exports = { resolveRepoPath };
