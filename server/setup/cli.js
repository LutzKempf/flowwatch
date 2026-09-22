// `flowwatch check`: the setup banner's list, for an agent. Each item that needs doing names the SETUP.md
// step that fixes it. The exit code is 1 exactly while the banner would show.
const path = require('path');
const http = require('http');
const { checkSetup, STEP } = require('./checkSetup');
const { collectorConfig } = require('../../hooks/lib/collectorConfig');

/** @type {Record<string, string>} */
const MARK = { ok: '✓', off: '–', 'not-set-up': '○' };
/** @type {(a: string, b: string) => boolean} */
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/**
 * Prints what is set up in a repo and what is missing, then whether its collector answers.
 * @param {string} repoRoot the repo to check
 * @param {{write?: (text: string) => void}} [io] where the report goes (stdout by default)
 * @returns {Promise<number>} the exit code: 0 when set up, 1 while a required item is open
 */
function runCheck(repoRoot, { write = (t) => process.stdout.write(t) } = {}) {
  // The port this repo's hooks post to: the env, else the repo's own collector port, else the default.
  const port = Number(process.env.FLOWWATCH_PORT) || collectorConfig(repoRoot).port || 4477;
  const r = checkSetup({ repoRoot });
  const lines = ['Flowwatch setup in ' + repoRoot];
  for (const i of r.items) {
    const todo = i.state !== 'ok' && i.state !== 'off';
    lines.push(
      '  ' + (MARK[i.state] || '✗') + ' ' + i.title + ' — ' + i.detail + (todo ? '  → SETUP.md step ' + i.step : '')
    );
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = (/** @type {string} */ collectorLine) => {
      if (done) return;
      done = true;
      lines.push(collectorLine);
      const required = r.banner.filter((i) => i.required).length;
      lines.push(
        r.ok
          ? 'Set up.'
          : 'Not set up yet: ' +
              required +
              ' required item' +
              (required === 1 ? '' : 's') +
              ' need' +
              (required === 1 ? 's' : '') +
              ' doing (✗ above). This check exits 1 until they are done.'
      );
      write(lines.join('\n') + '\n');
      resolve(r.ok ? 0 : 1);
    };

    // The collector is not part of the verdict — it may simply not be started yet — but when it answers, it
    // says whether a session has reported.
    const req = http.get({ host: '127.0.0.1', port, path: '/api/setup', timeout: 1500 }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        let answer = null;
        try {
          answer = JSON.parse(body);
        } catch {
          /* not a collector's answer: said below */
        }
        // Only a collector of this version answers /api/setup with the repo it serves. Anything else on the
        // port — an older Flowwatch, another program — would still receive this repo's session events.
        if (res.statusCode !== 200 || !answer || !answer.repoRoot) {
          finish(
            'Collector: something on :' +
              port +
              " answers, but not as this repo's Flowwatch (an older version, " +
              'or another program). Give this repo its own port and data folder under "collector" in flowwatch.json ' +
              '(SETUP.md step ' +
              STEP.collector +
              ')'
          );
          return;
        }
        // Another repo's collector on this port would receive this repo's session events: say so.
        if (!same(answer.repoRoot, repoRoot)) {
          finish(
            'Collector: :' +
              port +
              ' is the collector of ' +
              answer.repoRoot +
              ', not this repo. Give this repo its own ' +
              'port and data folder under "collector" in flowwatch.json (SETUP.md step ' +
              STEP.collector +
              ')'
          );
          return;
        }
        const last = answer.lastEventAt;
        finish(
          'Collector: running on :' +
            port +
            ', ' +
            (last
              ? 'last session event ' + new Date(last).toISOString()
              : 'no session has reported yet (start a Claude Code session in this repo)')
        );
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => finish('Collector: not reachable on :' + port + ' (SETUP.md step ' + STEP.collector + ')'));
  });
}

module.exports = { runCheck };
