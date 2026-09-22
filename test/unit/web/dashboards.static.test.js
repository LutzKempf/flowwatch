// Static pins for the two dashboards (no DOM runtime in this jest project; these pins keep the
// offline-resilience wiring from silently regressing in the source).
const fs = require('fs');
const path = require('path');
const { WEB, pageFiles, ownFiles, pageFile } = require('./pageFiles');

const pub = (f) => fs.readFileSync(path.join(WEB, f), 'utf8');
const whole = (page) =>
  ownFiles(page)
    .map(([, text]) => text)
    .join('\n');

describe('dashboard offline resilience (collector down must not wedge the page)', () => {
  // The module that polls each page's main payload.
  for (const [page, poll] of [
    ['mission.html', 'pages/mission/main.js'],
    ['pipeline.html', 'pages/pipeline/polls.js'],
  ]) {
    test(`${page} wraps its poll in try/catch and drives the conn-status badge`, () => {
      const js = pageFile(page, poll);
      expect(js).toMatch(/try\s*\{/); // poll body guarded
      expect(js).toContain('setConnStatus(true)'); // failure -> visible badge
      expect(js).toContain('setConnStatus(false)'); // success -> badge cleared
    });
  }

  test('render.js owns the shared conn-status badge helper (id conn-status, offline text)', () => {
    const lib = pub('lib/render.js');
    expect(lib).toContain("'conn-status'");
    expect(lib).toContain('collector offline');
  });
});

describe('poll cadence matches server reality', () => {
  test('the Mission page polls /api/mission every 30 s (the server caches it for 30 s)', () => {
    const js = pageFile('mission.html', 'pages/mission/main.js');
    expect(js).toMatch(/setInterval\(load,\s*30000\)/);
    expect(js).not.toMatch(/setInterval\(load,\s*2000\)/);
  });

  test('the Pipeline page polls /api/pipeline every 2 s and never /api/mission', () => {
    // Nothing on the Pipeline page reads the mission payload, so a 30 s fetch of it would be waste.
    expect(pageFile('pipeline.html', 'pages/pipeline/main.js')).toMatch(/setInterval\(tick,\s*2000\)/);
    const page = whole('pipeline.html');
    expect(page).not.toContain("fetch('/api/mission')");
    expect(page).not.toContain("Data.get('mission')"); // nor through the data seam
    expect(page).not.toContain('MILESTONE_IDS');
  });
});

describe('agent-pipeline uses the shared escapeHtml (no duplicated escaper)', () => {
  test('loads /lib/render.js and drops the local esc()', () => {
    expect(pageFile('pipeline.html', 'pipeline.html')).toContain('src="/lib/render.js"');
    const page = whole('pipeline.html');
    expect(page).not.toMatch(/function esc\(/);
    expect(page).toContain('escapeHtml(');
  });
});

// A page's files are exactly what it loads: a module nothing imports is code no test above reads and no browser runs.
test.each(['mission.html', 'pipeline.html'])('%s loads every file of its own folder under pages/', (page) => {
  const folder = 'pages/' + page.replace(/\.html$/, '') + '/';
  const onDisk = fs.readdirSync(path.join(WEB, folder)).map((f) => folder + f);
  const loaded = pageFiles(page)
    .map(([rel]) => rel)
    .filter((rel) => rel.startsWith('pages/'));
  expect(loaded.sort()).toEqual(onDisk.sort());
});
