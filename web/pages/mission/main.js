// The Mission page: its sidebar and demo banner, then two polls. Every panel is drawn by render.js from the
// mission payload; the setup list drives the banner and which panels the sidebar offers.
Nav.initNav(); // the sidebar, and which panel this address shows
renderDemo(Data.demo); // the demo says what it is (render.js); a live page has no demo
Nav.startBadgePolls(20000); // Sessions and Gate pipeline badges: this page has neither panel
async function load() {
  // try/catch: a collector restart must show the offline badge, keep the last
  // rendered data, and never leave an unhandled rejection in the console.
  try {
    const r = await Data.get('mission');
    // An answer that is not a page is the collector's own reason, not an outage: say it as such.
    if (!r.ok) {
      const body = await r.json().catch(() => null);
      setConnStatus(false);
      setLoadError('Flowwatch could not build this page: ' + ((body && body.error) || 'HTTP ' + r.status));
      return;
    }
    const mc = await r.json();
    setLoadError(null);
    const bind = (k, v) => {
      const el = document.querySelector('[data-bind="' + k + '"]');
      if (el) el.textContent = v;
    };
    bind('total', mc.totals.total);
    bind('implemented', mc.totals.implemented);
    bind('breakdown', mc.totals.known_broken + ' known-broken · ' + mc.totals.aspirational + ' aspirational');
    bind('active-changes', mc.activeChanges);
    bind('archived', '+' + mc.archivedChanges + ' archived (completed & folded)');
    bind('prs-week', mc.velocity.trailing7d || 0); // a whole window, never a partial ISO week
    const panels = mc.panels || {};
    renderMission(mc.mission); // in render.js
    renderSources(mc.sources, panels); // in render.js
    renderValue(mc.value, panels.value); // in render.js
    renderMilestones(mc.milestones, mc.mission, mc.stages); // in render.js
    renderStages(mc.stages, panels.stages); // in render.js
    renderIdeas(mc.ideas, panels.ideas); // in render.js
    renderSpecBars(mc.capabilities, mc.sources, panels.specs);
    setConnStatus(false);
  } catch {
    setConnStatus(true); // DOM keeps last data
  }
}
load();
setInterval(load, 30000); // polled, no WebSocket — 30 s matches the server's cache of this payload
// The setup banner, and panels turned off leaving the sidebar (render.js). An outage is the poll above's to say.
async function loadSetup() {
  try {
    const r = await Data.get('setup');
    if (r.ok) renderSetup(await r.json());
  } catch {
    /* load() reports it */
  }
}
loadSetup();
setInterval(loadSetup, 30000);
