// The snapshot writer (demo/snapshot.js), against a collector serving the neutral fixture repo: every endpoint the
// pages read, saved exactly as the collector answered, and the moment it was taken.
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { startServer } = require('../../server/server');
const { snapshot } = require('../../demo/snapshot');
const { hashData, DATA_FILES } = require('../../demo/signoff');
const { build } = require('../../demo/build');
const { ENDPOINTS } = require('../../web/lib/data');

const FIXTURE_REPO = path.join(__dirname, '..', 'fixtures', 'repo');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fw-snapshot-'));
const AT = Date.UTC(2026, 8, 21, 14, 30);

async function collector() {
  const root = tmp();
  for (const d of ['app', 'projects']) fs.mkdirSync(path.join(root, d));
  return startServer({
    port: 0,
    dbPath: ':memory:',
    watchMs: 0,
    repoRoot: FIXTURE_REPO,
    logDir: path.join(root, 'logs'),
    inbox: {
      appDir: path.join(root, 'app'),
      projectsDir: path.join(root, 'projects'),
      repoRoot: FIXTURE_REPO,
      ttlMs: 60000,
    },
  });
}

test('writes every endpoint exactly as the collector answered it, and the moment it was taken', async () => {
  const srv = await collector();
  // What the collector actually sent: /api/pipeline stamps each answer, so a second request would not match.
  const answered = {};
  const real = global.fetch;
  const spy = jest.spyOn(global, 'fetch').mockImplementation(async (url, ...rest) => {
    const r = await real(url, ...rest);
    answered[new URL(url).pathname] = Buffer.from(await r.clone().arrayBuffer());
    return r;
  });
  const out = path.join(tmp(), 'data');
  try {
    await snapshot('http://127.0.0.1:' + srv.port, out, { project: 'checkout', now: () => AT });
  } finally {
    spy.mockRestore();
    await srv.close();
  }

  expect(Object.keys(answered).sort()).toEqual(ENDPOINTS.map((n) => '/api/' + n).sort());
  for (const name of ENDPOINTS) {
    const saved = fs.readFileSync(path.join(out, name + '.json'));
    expect([name, saved.equals(answered['/api/' + name])]).toEqual([name, true]);
    expect(() => JSON.parse(saved)).not.toThrow();
  }
  expect(JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8'))).toEqual({
    project: 'checkout',
    snapshotAt: AT,
  });
  expect(fs.readdirSync(out).sort()).toEqual([...DATA_FILES].sort());

  // Once signed, it is what the build takes.
  fs.writeFileSync(path.join(out, 'SIGNOFF'), hashData(out));
  expect(() => build({ dataDir: out, outDir: path.join(tmp(), 'site') })).not.toThrow();
});

test("without a project name, the snapshot is named after the collector's repo folder", async () => {
  const srv = await collector();
  const out = path.join(tmp(), 'data');
  try {
    await snapshot('http://127.0.0.1:' + srv.port, out);
  } finally {
    await srv.close();
  }
  const meta = JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8'));
  expect(meta.project).toBe('repo');
  expect(Number.isFinite(meta.snapshotAt)).toBe(true);
});

test('an endpoint that fails fails the snapshot, by name, and nothing is written', async () => {
  const app = express();
  app.get('/api/:name', (req, res) =>
    req.params.name === 'gates' ? res.status(500).json({ error: 'boom' }) : res.json({})
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const out = path.join(tmp(), 'data');
  try {
    await expect(snapshot('http://127.0.0.1:' + server.address().port, out, { project: 'x' })).rejects.toThrow(
      /gates: HTTP 500/
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
  expect(fs.existsSync(out)).toBe(false);
});
