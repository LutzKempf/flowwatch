// The sidebar's model: one list of groups and panels, shared by both dashboards and the collector.
const Nav = require('../../../web/lib/nav.js');

describe('resolvePanel', () => {
  test.each([
    ['/pipeline/sessions', 'Pipeline', 'sessions', true],
    ['/pipeline/gates', 'Pipeline', 'gates', true],
    ['/mission/milestones', 'Mission', 'milestones', true],
    ['/mission/stages', 'Mission', 'stages', true],
    ['/mission/ideas', 'Mission', 'ideas', true],
    ['/mission/specs', 'Mission', 'specs', true],
    ['/pipeline', 'Pipeline', 'sessions', false], // bare group → its first panel
    ['/pipeline/', 'Pipeline', 'sessions', false],
    ['/mission', 'Mission', 'milestones', false],
    ['/pipeline/nope', 'Pipeline', 'sessions', false], // unknown panel → first panel, not blank
    ['/pipeline/ideas', 'Pipeline', 'sessions', false],
    ['/pipeline/needs-me', 'Pipeline', 'sessions', false], // merged into Sessions
    ['/pipeline/phases', 'Pipeline', 'sessions', false], // a panel of the OTHER group is unknown here
    ['/mission/lifecycle', 'Mission', 'stages', false], // renamed: the old address lands on the new panel
    ['/pipeline/lifecycle', 'Pipeline', 'sessions', false], // ...only in its own group
  ])('%s → %s / %s (exact %s)', (path, group, panel, exact) => {
    const r = Nav.resolvePanel(path);
    expect(r.group.group).toBe(group);
    expect(r.panel.id).toBe(panel);
    expect(r.exact).toBe(exact);
  });

  test.each(['/', '/pipeline-x', '/api/inbox', '', null])('%p is outside both groups', (path) => {
    expect(Nav.resolvePanel(path)).toBeNull();
  });

  test('panel ids are unique across both groups, and the landing is a real panel', () => {
    const ids = Nav.NAV.flatMap((g) => g.panels.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(6);
    expect(Nav.resolvePanel(Nav.LANDING).exact).toBe(true);
  });
});

describe('navHtml', () => {
  test('one link per panel, grouped, only the current one selected', () => {
    const html = Nav.navHtml(Nav.resolvePanel('/pipeline/gates'));
    expect(html.match(/class="nav-it/g)).toHaveLength(6);
    expect(html.match(/nav-it on/g)).toHaveLength(1);
    expect(html).toContain('href="/pipeline/gates" data-nav="gates" aria-current="page"');
    expect(html).toContain('href="/mission/ideas" data-nav="ideas"');
    // Both labels must be there: indexOf's -1 for a missing one is "less than" anything, which let the old
    // label "Flowwatch" pass this line after the group was renamed.
    expect(html).toContain('nav-grp">Mission<');
    expect(html.indexOf('nav-grp">Mission<')).toBeLessThan(html.indexOf('nav-grp">Pipeline<'));
  });
});

describe('showPanel', () => {
  // A minimal stand-in for the page: panel containers and sidebar links.
  function page() {
    const panels = ['sessions', 'gates'].map((id) => ({ dataset: { panel: id }, hidden: false }));
    const links = Nav.NAV.flatMap((g) => g.panels).map((p) => {
      const link = { dataset: { nav: p.id }, on: false, attrs: {} };
      link.classList = {
        toggle: (_c, on) => {
          link.on = on;
        },
      };
      link.setAttribute = (k, v) => {
        link.attrs[k] = v;
      };
      link.removeAttribute = (k) => {
        delete link.attrs[k];
      };
      return link;
    });
    global.document = { title: '', querySelectorAll: (s) => (s === '[data-panel]' ? panels : links) };
    return { panels, links };
  }
  afterEach(() => {
    delete global.document;
  });

  test('unhides exactly the chosen panel, selects exactly its item, titles the tab', () => {
    const { panels, links } = page();
    Nav.showPanel(Nav.resolvePanel('/pipeline/sessions'));
    expect(panels.filter((p) => !p.hidden).map((p) => p.dataset.panel)).toEqual(['sessions']);
    expect(links.filter((l) => l.on).map((l) => l.dataset.nav)).toEqual(['sessions']);
    expect(links.find((l) => l.dataset.nav === 'sessions').attrs['aria-current']).toBe('page');
    expect(links.find((l) => l.dataset.nav === 'gates').attrs['aria-current']).toBeUndefined();
    expect(global.document.title).toBe('Flowwatch — Sessions');
  });

  test('switching again moves both the panel and the selection', () => {
    const { panels, links } = page();
    Nav.showPanel(Nav.resolvePanel('/pipeline/sessions'));
    Nav.showPanel(Nav.resolvePanel('/pipeline/gates'));
    expect(panels.filter((p) => !p.hidden).map((p) => p.dataset.panel)).toEqual(['gates']);
    expect(links.filter((l) => l.on).map((l) => l.dataset.nav)).toEqual(['gates']);
  });
});

describe('waitingBadge — the inbox’s own count', () => {
  test.each([
    [{ items: [{}, {}, {}] }, '3', 'alert'],
    [{ items: [] }, '', 'quiet'], // nothing waiting: no number to shout
    [null, '?', 'unknown'], // never a 0 it did not read
    [{ error: 'boom' }, '?', 'unknown'],
  ])('%j → %p %p', (inbox, text, tone) => {
    expect(Nav.waitingBadge(inbox)).toEqual({ text, tone });
  });
});

describe('gateBadge — the scheduler state the gate panel shows', () => {
  const q = (o) => ({ state: 'data', format: 1, running: [], waiting: [], scheduler: {}, ...o });
  test.each([
    [q({ scheduler: { stalled: true }, running: [{}] }), 'stalled', 'alert'], // stalled wins
    [q({ running: [{}], waiting: [{}, {}] }), '1 running', 'busy'],
    [q({ waiting: [{}, {}] }), '2 queued', 'busy'],
    [q({}), '', 'quiet'],
    [{ state: 'error', reason: 'gates: its command exited with code 1' }, '?', 'unknown'],
    [{ state: 'not-set-up' }, '?', 'unknown'],
    [q({ scheduler: undefined, running: [{}] }), '1 running', 'busy'], // a repo whose gates have no scheduler
    [null, '?', 'unknown'],
  ])('%j → %p %p', (queue, text, tone) => {
    expect(Nav.gateBadge(queue)).toEqual({ text, tone });
  });
});
