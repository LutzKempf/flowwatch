// Flowwatch's sidebar: the ONE list of groups and panels both dashboards share, the address →
// panel rule the collector's routes use too, and the two badges. A plain browser script (no build);
// the collector and the tests require() it, so the list cannot drift between server and pages.
(function (/** @type {Record<string, any>} the page's window; the module's own `this` when required */ root) {
  /**
   * @typedef {{id: string, label: string, icon: string}} Panel
   * @typedef {{group: string, base: string, file: string, panels: Panel[]}} Group
   * @typedef {{group: Group, panel: Panel, exact: boolean}} Place a group, its panel, and whether the address named it
   */
  /** @type {Group[]} */
  const NAV = [
    {
      group: 'Mission',
      base: '/mission',
      file: 'mission.html',
      panels: [
        { id: 'milestones', label: 'Milestones and stats', icon: '◆' },
        { id: 'stages', label: 'Stages', icon: '▦' },
        { id: 'ideas', label: 'Ideas', icon: '✦' },
        { id: 'specs', label: 'Specs', icon: '≡' },
      ],
    },
    {
      group: 'Pipeline',
      base: '/pipeline',
      file: 'pipeline.html',
      panels: [
        // Sessions took over the Needs me and Phases and stats panels: their old addresses are unknown
        // panels now, so the collector redirects them here.
        { id: 'sessions', label: 'Sessions', icon: '●' },
        { id: 'gates', label: 'Gate pipeline', icon: '▶' },
      ],
    },
  ];
  const LANDING = '/pipeline/sessions';
  // Panels that were renamed: the old address lands on the panel under its new name, in its own group.
  /** @type {Object<string, string>} */
  const RENAMED = { lifecycle: 'stages' };

  /**
   * The group and panel an address names. A bare group address, or a panel name the group does not
   * have, resolves to the group's first panel with exact:false (the collector redirects those); a renamed
   * panel's old name resolves to the panel it became, also with exact:false.
   * @param {string} pathname
   * @returns {Place|null} null outside both groups
   */
  function resolvePanel(pathname) {
    const p = String(pathname || '').replace(/\/+$/, '');
    for (const g of NAV) {
      if (p !== g.base && !p.startsWith(g.base + '/')) continue;
      const name = p.slice(g.base.length + 1);
      const panel = g.panels.find((x) => x.id === name);
      const renamed = g.panels.find((x) => x.id === RENAMED[name]);
      return { group: g, panel: panel || renamed || g.panels[0], exact: Boolean(panel) };
    }
    return null;
  }

  // The demo is a static copy on plain hosting under a subpath (GitHub Pages: /flowwatch/), where no address the
  // host has no file for can work. So there a panel is its page and a fragment (pipeline.html#gates): the fragment
  // never reaches the host, and a reload or a shared link only ever asks it for a page it has.

  /**
   * A panel's address: its collector path live, its page and fragment in the demo.
   * @param {Group} g
   * @param {Panel} p
   * @param {boolean} demo
   * @returns {string}
   */
  function hrefOf(g, p, demo) {
    return demo ? g.file + '#' + p.id : g.base + '/' + p.id;
  }

  /**
   * The group and panel a location names (resolvePanel's answer). Live, its path alone; in the demo, the page its
   * path ends in (with or without .html) and its fragment, under any subpath.
   * @param {{pathname: string, hash: string}} loc location, or a link
   * @param {boolean} demo
   */
  function panelAt(loc, demo) {
    if (!demo) return resolvePanel(loc.pathname);
    const file = String(loc.pathname || '')
      .split('/')
      .pop();
    const g = NAV.find((x) => file && (x.file === file || x.file === file + '.html'));
    return g ? resolvePanel(g.base + '/' + String(loc.hash || '').slice(1)) : null;
  }

  /**
   * What the history keeps of an address: its path live, its path and fragment in the demo.
   * @type {(loc: {pathname: string, hash: string}, demo: boolean) => string}
   */
  const addrOf = (loc, demo) => (demo ? loc.pathname + loc.hash : loc.pathname);

  /**
   * The sidebar's markup for the current panel. Labels are this file's constants, never user data.
   * @param {Place|null} current
   * @param {boolean} demo
   * @returns {string}
   */
  function navHtml(current, demo) {
    return (
      '<div class="nav-brand">Flowwatch</div>' +
      NAV.map(
        (g) =>
          '<div class="nav-grp">' +
          g.group +
          '</div>' +
          g.panels
            .map((p) => {
              const on = Boolean(current) && /** @type {Place} */ (current).panel.id === p.id;
              return (
                '<a class="nav-it' +
                (on ? ' on' : '') +
                '" href="' +
                hrefOf(g, p, demo) +
                '" data-nav="' +
                p.id +
                '"' +
                (on ? ' aria-current="page"' : '') +
                ' title="' +
                p.label +
                '"><span class="nav-ic" aria-hidden="true">' +
                p.icon +
                '</span><span class="nav-lb">' +
                p.label +
                '</span><span class="nav-badge" data-badge="' +
                p.id +
                '"></span></a>'
              );
            })
            .join('')
      ).join('')
    );
  }

  /**
   * Shows exactly the current panel, selects exactly its sidebar item, and titles the tab.
   * @param {Place} current
   */
  function showPanel(current) {
    const panels = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-panel]'));
    for (const el of panels) el.hidden = el.dataset.panel !== current.panel.id;
    for (const a of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#nav .nav-it'))) {
      const on = a.dataset.nav === current.panel.id;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    document.title = 'Flowwatch — ' + current.panel.label;
  }

  /**
   * Draws the sidebar into #nav and shows the panel the address names. A click on a panel of THIS
   * page's group switches in place (pushState, Back works); a click on the other group is left to the
   * browser as a normal page load.
   * @returns {Place|null} the current panel, or null when the page has no #nav or the address is foreign
   */
  function initNav() {
    const nav = document.getElementById('nav');
    const demo = Boolean(root.Data && root.Data.demo); // the data seam (lib/data.js) knows
    const cur = panelAt(location, demo);
    if (!nav || !cur) return null;
    // Live, the collector redirects an address with no known panel; a static host cannot, so the page does.
    if (demo && !cur.exact) history.replaceState(null, '', hrefOf(cur.group, cur.panel, true));
    nav.innerHTML = navHtml(cur, demo);
    showPanel(cur);
    nav.addEventListener('click', (e) => {
      const a = /** @type {HTMLAnchorElement|null} */ (/** @type {Element} */ (e.target).closest('a.nav-it'));
      if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const next = panelAt(a, demo);
      if (!next || next.group !== /** @type {Place} */ (panelAt(location, demo)).group) return;
      e.preventDefault();
      if (addrOf(a, demo) !== addrOf(location, demo)) history.pushState(null, '', addrOf(a, demo));
      showPanel(next);
    });
    addEventListener('popstate', () => {
      const c = panelAt(location, demo);
      if (c) showPanel(c);
    });
    return cur;
  }

  /**
   * @typedef {{text: string, tone: string}} Badge
   */

  /**
   * Sessions: the inbox's own count, one per item — the "N waiting on you" its panel prints.
   * @param {any} inbox the /api/inbox answer, or null when it failed
   * @returns {Badge}
   */
  function waitingBadge(inbox) {
    if (!inbox || !Array.isArray(inbox.items)) return { text: '?', tone: 'unknown' };
    const n = inbox.items.length;
    return n ? { text: String(n), tone: 'alert' } : { text: '', tone: 'quiet' };
  }

  /**
   * Gate pipeline: the scheduler's state as the gate panel reports it; a stall outranks everything.
   * @param {any} q the /api/gates answer, or null when it failed
   * @returns {Badge}
   */
  function gateBadge(q) {
    if (!q || q.state !== 'data') return { text: '?', tone: 'unknown' };
    if (q.scheduler && q.scheduler.stalled) return { text: 'stalled', tone: 'alert' };
    if (q.running.length) return { text: q.running.length + ' running', tone: 'busy' };
    if (q.waiting.length) return { text: q.waiting.length + ' queued', tone: 'busy' };
    return { text: '', tone: 'quiet' };
  }

  /**
   * @param {string} panelId
   * @param {Badge} badge
   */
  function setBadge(panelId, badge) {
    const el = document.querySelector('#nav [data-badge="' + panelId + '"]');
    if (!el) return;
    el.textContent = badge.text;
    el.className = 'nav-badge ' + badge.tone;
  }

  /**
   * For a page that has neither panel (the Mission page): fetch both sources itself. The Pipeline page
   * never calls this — its badges come from the payloads its panels render, so they cannot disagree.
   * Sets #nav[data-badges=loaded] once both first answers are in, so a browser test can wait on it.
   * @param {number} ms how often
   * @returns {ReturnType<typeof setInterval>}
   */
  function startBadgePolls(ms) {
    // Reads through the data seam, by endpoint names written out: the pages' read-only rule
    // (test/unit/web/dashboards.cleanup.static.test.js) checks every one.
    const read = async (/** @type {Promise<Response>} */ pending) => {
      try {
        const r = await pending;
        return r.ok ? await r.json() : null;
      } catch {
        return null;
      }
    };
    const run = async () => {
      const [inbox, gates] = await Promise.all([read(root.Data.get('inbox')), read(root.Data.get('gates'))]);
      setBadge('sessions', waitingBadge(inbox));
      setBadge('gates', gateBadge(gates));
      const nav = document.getElementById('nav');
      if (nav) nav.dataset.badges = 'loaded';
    };
    run();
    return setInterval(run, ms);
  }

  const api = {
    NAV,
    LANDING,
    resolvePanel,
    hrefOf,
    panelAt,
    navHtml,
    showPanel,
    initNav,
    waitingBadge,
    gateBadge,
    setBadge,
    startBadgePolls,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Nav = api;
})(/** @type {any} */ (this));
