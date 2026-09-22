// The pages' one door to their data and their clock (web/lib/data.js). Live it must do exactly what the pages did
// before it: a GET of /api/<name>, and the real clock. In the demo, a static copy with no collector behind it, a read
// is the snapshot's own data/<name>.json and the clock stands at the moment the snapshot was taken.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Data = require('../../../web/lib/data.js');
const { openDb } = require('../../../server/db');
const { createApp } = require('../../../server/collector');
const { ownFiles, pageFile } = require('./pageFiles');

const WEB = path.join(__dirname, '..', '..', '..', 'web');
const SRC = fs.readFileSync(path.join(WEB, 'lib', 'data.js'), 'utf8');
const SNAPSHOT_AT = Date.UTC(2026, 8, 21, 14, 30);

// The script as a page runs it: in a window that may carry the build's demo config, with a fetch that records calls.
function inPage(config) {
  const calls = [];
  const win = {
    fetch: (...args) => {
      calls.push(args);
      return Promise.resolve('the answer');
    },
  };
  if (config) win.FLOWWATCH_DEMO = config;
  vm.createContext(win);
  vm.runInContext(SRC, win);
  return { D: win.Data, calls };
}

describe('live', () => {
  test.each(Data.ENDPOINTS)('a read of %s is a plain GET of /api/%s, as the pages made it before', async (name) => {
    const { D, calls } = inPage(null);
    await expect(D.get(name)).resolves.toBe('the answer');
    expect(calls).toEqual([['/api/' + name]]);
    expect(D.demo).toBeNull();
  });

  test('the clock is the real one', () => {
    const spy = jest.spyOn(Date, 'now').mockReturnValue(1234);
    try {
      expect(Data.now()).toBe(1234);
    } finally {
      spy.mockRestore();
    }
    expect(Math.abs(Data.now() - Date.now())).toBeLessThan(1000);
  });
});

describe('demo', () => {
  const config = { project: 'checkout', snapshotAt: SNAPSHOT_AT };

  test.each(Data.ENDPOINTS)('a read of %s is the snapshot file data/%s.json, relative to the page', async (name) => {
    const { D, calls } = inPage(config);
    await expect(D.get(name)).resolves.toBe('the answer');
    // Relative: the site sits under a subpath (/flowwatch/ on GitHub Pages), where "/data/…" would 404.
    expect(calls).toEqual([['data/' + name + '.json']]);
  });

  test('the clock stands at the moment of the snapshot, however long the page is open', () => {
    const { D } = inPage(config);
    expect(D.now()).toBe(SNAPSHOT_AT);
    expect(D.now()).toBe(SNAPSHOT_AT);
    expect(D.demo).toEqual(config);
  });
});

test('a name that is not an endpoint is refused, never turned into a URL', () => {
  for (const name of ['../secrets', 'sessions/1/milestone', 'Pipeline', '', undefined]) {
    expect(() => Data.urlOf(name, false)).toThrow(/no such endpoint/);
    expect(() => Data.urlOf(name, true)).toThrow(/no such endpoint/);
  }
});

test('the endpoints are exactly the GET /api routes the collector serves', () => {
  const app = createApp(openDb(':memory:'));
  const routes = app._router.stack
    .filter((l) => l.route && l.route.methods.get && l.route.path.startsWith('/api/'))
    .map((l) => l.route.path.slice('/api/'.length));
  expect(routes.sort()).toEqual([...Data.ENDPOINTS].sort());
});

// A page's markup, styles and its own modules, as one text.
const ownText = (file) =>
  ownFiles(file)
    .map(([, text]) => text)
    .join('\n');

describe.each(['mission.html', 'pipeline.html'])('%s', (file) => {
  const html = pageFile(file, file);
  const scripts = [...html.matchAll(/<script src="\/lib\/([^"]+)"/g)].map((m) => m[1]);
  const page = ownText(file);

  test('loads the data seam before every other script', () => {
    expect(scripts[0]).toBe('data.js');
  });

  test('reads every endpoint through the seam, by its name', () => {
    const reads = [...page.matchAll(/Data\.get\(([^)]*)\)/g)].map((m) => m[1]);
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads)
      expect([r, /^'[a-z]+'$/.test(r) && Data.ENDPOINTS.includes(r.slice(1, -1))]).toEqual([r, true]);
    expect(page).not.toMatch(/\bfetch\(/);
  });

  test('reads the clock only through the seam', () => {
    expect(page).not.toMatch(/Date\.now\(\)/);
    expect(page).not.toMatch(/new Date\(\)/);
  });
});

test('pipeline.html reads the clock through the seam at each of its four places', () => {
  const file = (name) => pageFile('pipeline.html', 'pages/pipeline/' + name);
  expect(ownText('pipeline.html').match(/Data\.now\(\)/g)).toHaveLength(4);
  expect(file('rows.js')).toContain('now: Data.now()'); // the board's ages
  expect(file('state.js')).toContain('new Date(Data.now()).toISOString()'); // when a sorting was made
  expect(file('gates.js')).toContain('const now = Data.now();'); // how long a gate has run
  expect(file('gates.js')).toContain('gatesFetchedAt = Data.now();'); // how old the gate queue is
});

test('the sidebar badges read through the seam too', () => {
  const nav = fs.readFileSync(path.join(WEB, 'lib', 'nav.js'), 'utf8');
  expect(nav).toContain("Data.get('inbox')");
  expect(nav).toContain("Data.get('gates')");
  expect(nav).not.toMatch(/\bfetch\(/);
});
