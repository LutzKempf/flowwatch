// The demo banner (render.js renderDemo). Every page of the demo says what it is: whose dashboards, from when, and
// that nothing clicked is saved. Sessions adds one line on how to read the board. The setup banner goes: it tells
// the viewer to set Flowwatch up in their own repo, and a visitor to the demo has none. A live page is untouched.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pageFile } = require('./pageFiles');

const WEB = path.join(__dirname, '..', '..', '..', 'web');
const SRC = fs.readFileSync(path.join(WEB, 'lib', 'render.js'), 'utf8');
const DEMO = { project: 'checkout', snapshotAt: Date.UTC(2026, 8, 21, 22, 30) };

// What a reader sees of some inserted markup: its text, unescaped.
const text = (html) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

// A stand-in page: the content column, the Sessions panel's title (on the Pipeline page only) and the setup banner.
function page({ sessions }) {
  const inserted = { wrap: [], sessions: [] };
  const setupBanner = {
    hidden: true,
    innerHTML: '',
    removed: false,
    remove() {
      this.removed = true;
    },
  };
  const wrap = { insertAdjacentHTML: (where, html) => inserted.wrap.push([where, html]) };
  const title = { insertAdjacentHTML: (where, html) => inserted.sessions.push([where, html]) };
  const document = {
    getElementById: (id) => (id === 'setup-banner' && !setupBanner.removed ? setupBanner : null),
    querySelector: (sel) =>
      sel === '.wrap' ? wrap : sel === '[data-panel="sessions"] .panel-title' && sessions ? title : null,
  };
  const sandbox = { document, window: {} };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { sandbox, inserted, setupBanner };
}

test('the banner names the project and the day of the snapshot, first thing on the page', () => {
  const p = page({ sessions: false });
  p.sandbox.renderDemo(DEMO);
  expect(p.inserted.wrap).toHaveLength(1);
  const [where, html] = p.inserted.wrap[0];
  expect(where).toBe('afterbegin');
  expect(html).toMatch(/^<div class="demo-banner" id="demo-banner" role="note">/);
  expect(text(html)).toBe(
    "Demo: a snapshot of checkout's dashboards on 21 September 2026. Nothing you click is saved."
  );
});

test('Sessions says how to read the board, right under its title; no other panel does', () => {
  const pipeline = page({ sessions: true });
  pipeline.sandbox.renderDemo(DEMO);
  expect(pipeline.inserted.sessions).toHaveLength(1);
  const [where, html] = pipeline.inserted.sessions[0];
  expect(where).toBe('afterend');
  expect(text(html)).toBe("Each row is an AI agent's session; the top rows are waiting on a person.");

  const mission = page({ sessions: false });
  mission.sandbox.renderDemo(DEMO);
  expect(mission.inserted.sessions).toEqual([]);
});

test('the setup banner is gone, and stays gone when the setup answer asks for it', () => {
  const p = page({ sessions: true });
  p.sandbox.renderDemo(DEMO);
  expect(p.setupBanner.removed).toBe(true);
  p.sandbox.renderSetup({
    items: [],
    banner: [{ required: true, title: 'Session tracking', detail: 'not installed', step: '5' }],
  });
  expect(p.setupBanner.innerHTML).toBe('');
});

test('the project name is text, never markup', () => {
  const p = page({ sessions: false });
  p.sandbox.renderDemo({ project: '<img src=x onerror=alert(1)>', snapshotAt: DEMO.snapshotAt });
  const html = p.inserted.wrap[0][1];
  expect(html).not.toContain('<img');
  expect(text(html)).toContain("a snapshot of <img src=x onerror=alert(1)>'s dashboards");
});

test('a live page is left as it is', () => {
  const p = page({ sessions: true });
  p.sandbox.renderDemo(null);
  expect(p.inserted).toEqual({ wrap: [], sessions: [] });
  expect(p.setupBanner.removed).toBe(false);
});

test.each(['mission.html', 'pipeline.html'])(
  '%s draws the banner from the demo config, straight after the sidebar',
  (file) => {
    // the page's own script, the module it loads
    const main = pageFile(file, 'pages/' + file.replace(/\.html$/, '') + '/main.js');
    expect(main).toMatch(/Nav\.initNav\(\);[^\n]*\nrenderDemo\(Data\.demo\);/);
  }
);
