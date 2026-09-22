// The address scheme. Live, a panel is a path the collector routes (/pipeline/gates). In the demo, a static copy on
// plain hosting under a subpath (GitHub Pages: /flowwatch/), a panel is its page and a fragment (pipeline.html#gates):
// the fragment never reaches the host, so a reload or a shared link can only ever ask it for a file it has.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Nav = require('../../../web/lib/nav.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'web', 'lib', 'nav.js'), 'utf8');
const at = (pathname, hash = '') => ({ pathname, hash });
const [MISSION, PIPELINE] = Nav.NAV;

test('live, a panel is its collector path; in the demo, its page and a fragment', () => {
  expect(Nav.hrefOf(PIPELINE, PIPELINE.panels[1], false)).toBe('/pipeline/gates');
  expect(Nav.hrefOf(PIPELINE, PIPELINE.panels[1], true)).toBe('pipeline.html#gates');
  expect(Nav.hrefOf(MISSION, MISSION.panels[1], true)).toBe('mission.html#stages');
});

test.each(Nav.NAV.flatMap((g) => g.panels.map((p) => [g.file + '#' + p.id, g.group, p.id])))(
  'the demo address %s opens that panel, under any subpath',
  (href, group, id) => {
    const [file, hash] = href.split('#');
    for (const base of ['/flowwatch/', '/', '/a/b/']) {
      const r = Nav.panelAt(at(base + file, '#' + hash), true);
      expect([r.group.group, r.panel.id, r.exact]).toEqual([group, id, true]);
    }
  }
);

describe('panelAt in the demo', () => {
  test.each([
    [at('/flowwatch/pipeline.html'), 'Pipeline', 'sessions', false], // no fragment: the group's first panel
    [at('/flowwatch/pipeline.html', '#'), 'Pipeline', 'sessions', false],
    [at('/flowwatch/pipeline.html', '#nope'), 'Pipeline', 'sessions', false],
    [at('/flowwatch/pipeline.html', '#ideas'), 'Pipeline', 'sessions', false], // the other group's panel is unknown here
    [at('/flowwatch/mission.html', '#lifecycle'), 'Mission', 'stages', false], // renamed, as live
    [at('/flowwatch/mission', '#ideas'), 'Mission', 'ideas', true], // a host that drops the .html
  ])('%j → %s / %s (exact %s)', (loc, group, panel, exact) => {
    const r = Nav.panelAt(loc, true);
    expect([r.group.group, r.panel.id, r.exact]).toEqual([group, panel, exact]);
  });

  test.each([
    at('/flowwatch/'),
    at('/flowwatch/index.html', '#sessions'),
    at('/flowwatch/pipeline/sessions'),
    at('/pipeline/sessions'),
  ])('%j is no dashboard page of the demo', (loc) => {
    expect(Nav.panelAt(loc, true)).toBeNull();
  });
});

test('live, an address is its path alone: a fragment means nothing', () => {
  for (const p of ['/pipeline/gates', '/mission', '/pipeline/lifecycle', '/mission/lifecycle', '/', '/pipeline.html']) {
    expect(Nav.panelAt(at(p, '#stages'), false)).toEqual(Nav.resolvePanel(p));
  }
});

test('the demo sidebar links every panel by its page and fragment, never by a path the host does not have', () => {
  const html = Nav.navHtml(Nav.panelAt(at('/flowwatch/pipeline.html', '#gates'), true), true);
  expect(html.match(/class="nav-it/g)).toHaveLength(6);
  expect(html).toContain('href="pipeline.html#gates" data-nav="gates" aria-current="page"');
  expect(html).toContain('href="mission.html#ideas" data-nav="ideas"');
  expect(html).not.toMatch(/href="\//);
});

// initNav in a stand-in page: its address, its history and the sidebar's clicks. `Data` is the data seam, whose
// `demo` the build sets; a live page has a seam with none.
function page(pathname, hash, demo) {
  const history = [];
  const on = {};
  const nav = {
    innerHTML: '',
    addEventListener: (type, f) => {
      on['nav:' + type] = f;
    },
  };
  const win = {
    location: { pathname, hash },
    history: {
      pushState: (_s, _t, url) => history.push(['push', url]),
      replaceState: (_s, _t, url) => history.push(['replace', url]),
    },
    document: { title: '', getElementById: (id) => (id === 'nav' ? nav : null), querySelectorAll: () => [] },
    addEventListener: (type, f) => {
      on[type] = f;
    },
    Data: { demo: demo ? { project: 'checkout', snapshotAt: 0 } : null },
  };
  vm.createContext(win);
  vm.runInContext(SRC, win);
  const click = (link) => {
    let prevented = false;
    on['nav:click']({
      target: { closest: () => link },
      button: 0,
      preventDefault: () => {
        prevented = true;
      },
    });
    return prevented;
  };
  return { win, history, nav, on, click };
}

describe('initNav in the demo', () => {
  test('an address with no known panel is corrected in place, as the collector redirects it live', () => {
    const p = page('/flowwatch/pipeline.html', '', true);
    expect(p.win.Nav.initNav().panel.id).toBe('sessions');
    expect(p.history).toEqual([['replace', 'pipeline.html#sessions']]);
    expect(p.win.document.title).toBe('Flowwatch — Sessions');
    expect(p.nav.innerHTML).toContain('href="pipeline.html#gates"');
  });

  test('a panel of the page’s own group switches in place, to an address a reload reopens; Back comes back', () => {
    const p = page('/flowwatch/pipeline.html', '#sessions', true);
    p.win.Nav.initNav();
    expect(p.history).toEqual([]);
    expect(p.click({ pathname: '/flowwatch/pipeline.html', hash: '#gates' })).toBe(true);
    expect(p.history).toEqual([['push', '/flowwatch/pipeline.html#gates']]);
    expect(p.win.document.title).toBe('Flowwatch — Gate pipeline');
    p.win.location.hash = '#sessions';
    p.on.popstate();
    expect(p.win.document.title).toBe('Flowwatch — Sessions');
  });

  test('a panel of the other page is left to the browser, as a normal page load', () => {
    const p = page('/flowwatch/pipeline.html', '#sessions', true);
    p.win.Nav.initNav();
    expect(p.click({ pathname: '/flowwatch/mission.html', hash: '#ideas' })).toBe(false);
    expect(p.history).toEqual([]);
  });
});

describe('initNav live, unchanged', () => {
  test('the path names the panel, nothing is rewritten, and a click pushes the panel’s path', () => {
    const p = page('/pipeline/gates', '', false);
    expect(p.win.Nav.initNav().panel.id).toBe('gates');
    expect(p.nav.innerHTML).toContain('href="/pipeline/sessions"');
    expect(p.click({ pathname: '/pipeline/sessions', hash: '' })).toBe(true);
    expect(p.history).toEqual([['push', '/pipeline/sessions']]);
    expect(p.click({ pathname: '/mission/ideas', hash: '' })).toBe(false);
  });
});
