// The demo build (demo/build.js): the dashboards as they are, reading a signed snapshot instead of a collector, as a
// static site that works under a subpath (GitHub Pages: /flowwatch/).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../../../demo/build');
const { hashData, DATA_FILES } = require('../../../demo/signoff');
const { NAV } = require('../../../web/lib/nav');

const ROOT = path.join(__dirname, '..', '..', '..');
const WEB = path.join(ROOT, 'web');
const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'demo');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fw-build-'));
const PAGES = NAV.map((g) => g.file);
const CONFIG = /<script>window\.FLOWWATCH_DEMO=(.*?);<\/script>\n/;
// Every file under a folder, as sorted paths relative to it with forward slashes.
const filesUnder = (dir) =>
  fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
    .sort();

// A copy of the fixture snapshot, changed by `edit`, signed or not.
function snapshot(edit = () => {}, { sign = true } = {}) {
  const dir = tmp();
  for (const f of DATA_FILES) fs.copyFileSync(path.join(FIXTURE, f), path.join(dir, f));
  edit(dir);
  if (sign) fs.writeFileSync(path.join(dir, 'SIGNOFF'), hashData(dir));
  return dir;
}

test('refuses data whose hash has no matching sign-off, and writes nothing', () => {
  const data = snapshot((d) => fs.appendFileSync(path.join(d, 'pipeline.json'), ' '), { sign: false });
  fs.copyFileSync(path.join(FIXTURE, 'SIGNOFF'), path.join(data, 'SIGNOFF')); // signed for the bytes before the edit
  const out = path.join(tmp(), 'site');
  expect(() => build({ dataDir: data, outDir: out })).toThrow(/no matching sign-off/);
  expect(fs.existsSync(out)).toBe(false);
});

test('refuses a folder with no snapshot in it', () => {
  expect(() => build({ dataDir: tmp(), outDir: path.join(tmp(), 'site') })).toThrow(/is missing .*meta\.json/);
});

test('refuses a snapshot whose meta.json does not say whose dashboards, or when', () => {
  const data = snapshot((d) =>
    fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify({ project: '', snapshotAt: 'noon' }))
  );
  expect(() => build({ dataDir: data, outDir: path.join(tmp(), 'site') })).toThrow(/meta\.json needs/);
});

describe('a build of the signed fixture', () => {
  const out = path.join(tmp(), 'site');
  const meta = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'meta.json'), 'utf8'));
  beforeAll(() => {
    build({ dataDir: FIXTURE, outDir: out });
  });
  const built = (f) => fs.readFileSync(path.join(out, f), 'utf8');

  test('writes both pages, every file of lib/ and pages/ as it is, .nojekyll and index.html', () => {
    for (const f of [...PAGES, '.nojekyll', 'index.html'])
      expect([f, fs.existsSync(path.join(out, f))]).toEqual([f, true]);
    for (const dir of ['lib', 'pages']) {
      const files = filesUnder(path.join(WEB, dir));
      expect(files.length).toBeGreaterThan(0);
      expect(filesUnder(path.join(out, dir))).toEqual(files);
      for (const f of files)
        expect([f, built(dir + '/' + f) === fs.readFileSync(path.join(WEB, dir, f), 'utf8')]).toEqual([f, true]);
    }
  });

  test('publishes exactly the signed data files, byte for byte, and not the SIGNOFF', () => {
    expect(fs.readdirSync(path.join(out, 'data')).sort()).toEqual([...DATA_FILES].sort());
    for (const f of DATA_FILES) {
      expect(fs.readFileSync(path.join(out, 'data', f)).equals(fs.readFileSync(path.join(FIXTURE, f)))).toBe(true);
    }
  });

  test('index.html opens Sessions', () => {
    expect(built('index.html')).toContain('<meta http-equiv="refresh" content="0; url=pipeline.html#sessions">');
    expect(built('index.html')).toContain('<a href="pipeline.html#sessions">');
  });

  // GitHub Pages serves 404.html at whatever address was missing, so a relative link would resolve against it.
  test('404.html says the address is not in the demo and links to Sessions by its full address', () => {
    expect(built('404.html')).toContain('not part of the Flowwatch demo');
    expect(built('404.html')).toContain('<a href="/flowwatch/pipeline.html#sessions">');
  });

  test.each(PAGES)('%s carries the demo config, before any script runs', (file) => {
    const html = built(file);
    const m = html.match(CONFIG);
    expect(JSON.parse(m[1])).toEqual({ project: meta.project, snapshotAt: meta.snapshotAt });
    expect(html.indexOf(m[0])).toBeLessThan(html.indexOf('<script src='));
    expect(html.indexOf(m[0])).toBeLessThan(html.indexOf('</head>'));
  });

  // A URL: an attribute value, a string in a script, or a stylesheet's url(); prose that names an endpoint is not one.
  // The pages' own modules and stylesheets are copied as they are, so they must carry none either.
  test.each([...PAGES, ...filesUnder(path.join(WEB, 'pages')).map((f) => 'pages/' + f)])(
    '%s keeps no absolute /lib/, /pages/ or /api/ URL',
    (file) => {
      expect(built(file)).not.toMatch(/(["'=]|url\()\/(lib|pages|api)\//);
    }
  );

  test.each(PAGES)('every script and stylesheet %s loads is a file of the site, found relative to the page', (file) => {
    const urls = [...built(file).matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThanOrEqual(4);
    for (const u of urls) expect([u, fs.existsSync(path.join(out, u))]).toEqual([u, true]);
  });

  test.each(PAGES)('%s is otherwise the live page, byte for byte', (file) => {
    const back = built(file)
      .replace(CONFIG, '')
      .replace(/(src|href)="(lib|pages)\//g, '$1="/$2/');
    expect(back).toBe(fs.readFileSync(path.join(WEB, file), 'utf8'));
  });
});

test('nothing in the metadata can close the config script', () => {
  const project = '</script><script>alert(1)</script>';
  const data = snapshot((d) => fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify({ project, snapshotAt: 1 })));
  const out = path.join(tmp(), 'site');
  build({ dataDir: data, outDir: out });
  const html = fs.readFileSync(path.join(out, 'pipeline.html'), 'utf8');
  expect(html).not.toContain('<script>alert(1)');
  expect(JSON.parse(html.match(CONFIG)[1]).project).toBe(project);
});
