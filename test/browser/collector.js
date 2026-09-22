// A collector for the browser tests, started in the test's own process on a free port. Everything it would otherwise
// read from the machine it runs on (its database and logs, the Claude app's session records, the transcripts, the
// installed skills) is a temp folder the test fills, so no page can show anything of this machine.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer } = require('../../server/server');

/**
 * One session as the Claude app and Claude Code leave it: the app's record, and a transcript whose last turn handed
 * the turn back with a question, so the session is waiting on the operator.
 * @param {string} dir the collector's temp folder
 * @param {string} repoRoot
 * @param {{id: string, title: string, ask: string, cwd?: string}} s cwd: the session's folder, by default a worktree
 *   of repoRoot
 */
function writeSession(dir, repoRoot, s) {
  const now = new Date();
  fs.writeFileSync(
    path.join(dir, 'app', `local_${s.id}.json`),
    JSON.stringify({
      sessionId: `local_${s.id}`,
      cliSessionId: `cli-${s.id}`,
      cwd: s.cwd || path.join(repoRoot, '.claude', 'worktrees', s.id),
      title: s.title,
      branch: `claude/${s.id}`,
      lastActivityAt: now.getTime(),
    })
  );
  fs.writeFileSync(
    path.join(dir, 'projects', 'repo', `cli-${s.id}.jsonl`),
    JSON.stringify({
      type: 'assistant',
      timestamp: now.toISOString(),
      message: { id: `m-${s.id}`, role: 'assistant', content: [{ type: 'text', text: s.ask }] },
    }) + '\n'
  );
}

/**
 * @param {{repoRoot: string, sessions?: Array<{id: string, title: string, ask: string, cwd?: string}>,
 *   skills?: string[]}} opts skills: the skill names installed on this pretend machine
 * @returns {Promise<{url: string, close: () => Promise<void>}>}
 */
async function startCollector({ repoRoot, sessions = [], skills = [] }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-browser-'));
  for (const sub of ['app', path.join('projects', 'repo'), 'skills'])
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  for (const s of sessions) writeSession(dir, repoRoot, s);
  for (const name of skills) {
    fs.mkdirSync(path.join(dir, 'skills', name));
    fs.writeFileSync(path.join(dir, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
  }
  const srv = await startServer({
    port: 0,
    dbPath: path.join(dir, 'data', 'pipeline.db'),
    logDir: path.join(dir, 'data', 'logs'),
    watchMs: 0,
    repoRoot,
    // A minute's cache: the page's 2 s polls then get the same answer, so a redraw never moves what a test is on.
    inbox: {
      appDir: path.join(dir, 'app'),
      projectsDir: path.join(dir, 'projects'),
      repoRoot,
      skillsDir: path.join(dir, 'skills'),
      ttlMs: 60_000,
    },
  });
  return {
    url: `http://127.0.0.1:${srv.port}`,
    close: async () => {
      await srv.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

module.exports = { startCollector };
