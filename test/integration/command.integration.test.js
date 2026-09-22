// `flowwatch start` serves the repo it is pointed at: the collector it starts answers /api/setup with that
// repo, keeps its data in the data folder it is given, and reads no transcripts from outside that repo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const BIN = path.resolve(__dirname, '..', '..', 'bin', 'flowwatch.js');
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));

test('start --repo serves that repo and keeps its data where FLOWWATCH_DATA_DIR says', async () => {
  const repo = tmp('fw-start-repo-');
  const dataDir = tmp('fw-start-data-');
  const child = spawn(process.execPath, [BIN, 'start', '--repo', repo], {
    windowsHide: true,
    env: {
      ...process.env,
      FLOWWATCH_PORT: '0',
      FLOWWATCH_DATA_DIR: dataDir,
      FLOWWATCH_PROJECTS_DIR: tmp('fw-start-none-'),
    },
  });
  try {
    const url = await new Promise((resolve, reject) => {
      let out = '';
      child.stdout.on('data', (d) => {
        out += d;
        const m = out.match(/open (http:\/\/127\.0\.0\.1:\d+)/);
        if (m) resolve(m[1]);
      });
      child.on('exit', (code) => reject(new Error('flowwatch start exited with ' + code + ': ' + out)));
    });
    const setup = await fetch(url + '/api/setup').then((r) => r.json());
    expect(path.resolve(setup.repoRoot)).toBe(path.resolve(repo));
    expect(fs.existsSync(path.join(dataDir, 'pipeline.db'))).toBe(true);
  } finally {
    child.kill();
  }
});
