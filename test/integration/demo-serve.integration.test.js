// `flowwatch demo`: builds the demo from a signed snapshot and serves it as GitHub Pages will, plain files under
// /flowwatch/. What the pages load must be files of the site; the collector's routes must not be there to lean on.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { DATA_FILES } = require('../../demo/signoff');

const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, 'bin', 'flowwatch.js');
const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'demo');

let child;
let site; // the address the command printed
// The command's own temp folder: stopping it from a test is a hard kill on Windows, which skips the command's
// clean-up, so the test removes the folder itself.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-demo-serve-'));
beforeAll(async () => {
  child = spawn(process.execPath, [BIN, 'demo', '--port', '0', '--data', FIXTURE], {
    windowsHide: true,
    env: { ...process.env, TMPDIR: TMP, TEMP: TMP, TMP },
  });
  site = await new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/open (http:\/\/127\.0\.0\.1:\d+\/flowwatch\/)\n/);
      if (m) resolve(m[1]);
    });
    child.stderr.on('data', (d) => {
      out += d;
    });
    child.once('exit', (code) => reject(new Error('flowwatch demo exited (' + code + '): ' + out)));
  });
});
afterAll(async () => {
  if (child && child.exitCode === null) {
    const gone = new Promise((r) => child.once('exit', r));
    child.kill();
    await gone;
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

const get = async (url) => {
  const r = await fetch(url, { redirect: 'manual' });
  return { status: r.status, body: await r.text() };
};

test('the address it prints opens Sessions', async () => {
  const r = await get(site);
  expect(r.status).toBe(200);
  expect(r.body).toContain('url=pipeline.html#sessions');
});

test('a page, a script, a stylesheet and a data file are all served from the site', async () => {
  const page = await get(site + 'pipeline.html');
  expect(page.status).toBe(200);
  expect(page.body).toContain('window.FLOWWATCH_DEMO=');
  expect(page.body).toContain('<script src="lib/data.js"></script>');
  expect((await get(site + 'mission.html')).status).toBe(200);
  expect((await get(site + 'lib/data.js')).status).toBe(200);
  expect((await get(site + 'lib/nav.css')).status).toBe(200);
  const data = await get(site + 'data/pipeline.json');
  expect(data.status).toBe(200);
  expect(data.body).toBe(fs.readFileSync(path.join(FIXTURE, 'pipeline.json'), 'utf8'));
});

// A browser runs a module script only when it is served as JavaScript; anything else leaves the page blank.
test("each page's modules and stylesheet are served, the modules as JavaScript", async () => {
  for (const page of ['pipeline', 'mission']) {
    expect(await get(site + page + '.html').then((r) => r.body)).toContain(
      '<script type="module" src="pages/' + page + '/main.js"></script>'
    );
    const main = await fetch(site + 'pages/' + page + '/main.js');
    expect([page, main.status, main.headers.get('content-type')]).toEqual([
      page,
      200,
      expect.stringMatching(/^(text|application)\/javascript\b/),
    ]);
    expect((await get(site + 'pages/' + page + '/page.css')).status).toBe(200);
  }
  // a module the entry imports, found relative to it
  expect((await get(site + 'pages/pipeline/board.js')).status).toBe(200);
});

test('no route of the collector is there: a panel path and the API are missing, so no page can depend on them', async () => {
  const origin = new URL(site).origin;
  for (const url of [
    site + 'pipeline/sessions',
    site + 'mission/stages',
    site + 'api/pipeline',
    origin + '/api/pipeline',
    origin + '/pipeline/sessions',
  ]) {
    expect([url, (await get(url)).status]).toEqual([url, 404]);
  }
});

test("an address under the site that has no file gets the demo's 404 page, as on GitHub Pages", async () => {
  const r = await get(site + 'pipeline/sessions');
  expect(r.status).toBe(404);
  expect(r.body).toContain('<a href="/flowwatch/pipeline.html#sessions">');
});

test('unsigned data is refused before anything is served', () => {
  const data = fs.mkdtempSync(path.join(TMP, 'unsigned-'));
  for (const f of DATA_FILES) fs.copyFileSync(path.join(FIXTURE, f), path.join(data, f));
  const out = spawnSync(process.execPath, [BIN, 'demo', '--port', '0', '--data', data], {
    encoding: 'utf8',
    windowsHide: true,
  });
  expect(out.status).toBe(1);
  expect(out.stderr).toMatch(/no matching sign-off/);
  expect(out.stdout).toBe('');
});
