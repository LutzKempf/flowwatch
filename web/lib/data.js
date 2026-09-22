// The pages' one door to their data and their clock. Live, a read is a GET of this collector's /api/<name> and the
// clock is the real one. In the demo, a static copy of the dashboards with no collector behind it, a read is the
// site's own data/<name>.json and the clock stands at the moment the snapshot was taken, so every "waiting 3h" reads
// as it did then. The demo build writes window.FLOWWATCH_DEMO ({ project, snapshotAt }) into each page before this
// script; a live page has none. A plain browser script (no build); the tests and the demo tools require() it.
(function (/** @type {Record<string, any>} the page's window; the module's own `this` when required */ root) {
  const ENDPOINTS = ['mission', 'pipeline', 'inbox', 'lanes', 'gates', 'setup'];
  const demo = (root && root.FLOWWATCH_DEMO) || null;

  /**
   * Where a read of one endpoint goes. Relative in the demo: the site sits under a subpath (/flowwatch/).
   * @param {string} name one of ENDPOINTS; anything else throws, so no page can make up a URL through here
   * @param {boolean} isDemo
   */
  function urlOf(name, isDemo) {
    if (!ENDPOINTS.includes(name)) throw new Error('flowwatch: no such endpoint "' + name + '"');
    return isDemo ? 'data/' + name + '.json' : '/api/' + name;
  }

  const api = {
    ENDPOINTS,
    urlOf,
    demo,
    /** A plain GET of one endpoint, answered as the browser's fetch answers it. */
    get: (/** @type {string} */ name) => fetch(urlOf(name, Boolean(demo))),
    /** Now, in ms: the snapshot's moment in the demo, the real clock live. */
    now: () => (demo ? demo.snapshotAt : Date.now()),
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Data = api;
})(/** @type {any} */ (this));
