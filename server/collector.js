const express = require('express');
const os = require('os');
const path = require('path');
const { ingestEvent } = require('./ingest');
const { buildPipeline, DEFAULT_MAX_AGE_DAYS } = require('./pipelineApi');
const { parseSpecsDir } = require('./repo/specParser');
const { parseChanges } = require('./repo/changesParser');
const { velocityFromRepo } = require('./repo/gitVelocity');
const { buildMissionControl } = require('./panels/mission');
const { checkValue } = require('./panels/value');
const { checkStages } = require('./panels/stages');
const { checkIdeas } = require('./panels/ideas');
const { readFeed } = require('./feeds');
const { missionOf } = require('./repo/missionFile');
const { readWiring } = require('./repo/settings');
const { checkSetup } = require('./setup/checkSetup');
const { buildInbox } = require('./sessions/buildInbox');
const { checkGates } = require('./panels/gates');
const { readLanes } = require('./sessions/buildLanes');
const { ownerTable } = require('./sessions/capabilityLane');
const { loadCategorizer } = require('./sessions/categorizer');
const { appRecordsDir } = require('./sessions/appRecordsDir');

/**
 * @typedef {{projectsDir: string, repoRoot: string, appDir?: string, inferCategory?: (...sources: string[]) => any,
 *   ttlMs?: number, skillsDir?: string}} InboxOptions where the inbox and the lanes read from; startServer sets
 *   the first two, a test may inject the rest
 * @typedef {{repoRoot?: string, repoDir?: string, specsDir?: string, changesDir?: string, mcTtlMs?: number,
 *   gatesTtlMs?: number, inbox?: Partial<InboxOptions>}} AppOptions
 */

/**
 * Builds the Express collector app: POST /events ingest, GET /api/pipeline,
 * GET /api/mission, GET /api/gates, GET /health.
 * @param {import('better-sqlite3').Database} db open pipeline db
 * @param {AppOptions} [opts] the repo, repo paths for the Mission page's parsers, the inbox's sources,
 *   and the cache TTLs
 * @returns {import('express').Express}
 */
function createApp(db, opts = {}) {
  const app = express();
  // 64kb: event bodies are tiny, but a bash event legitimately carries its full command —
  // a multi-kb heredoc/inline script must not be rejected at the boundary.
  app.use(express.json({ limit: '64kb' }));

  app.post('/events', (req, res) => {
    try {
      ingestEvent(db, req.body);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: /** @type {Error} */ (e).message });
    }
  });

  // Session age window: ?days= wins, else FLOWWATCH_MAX_AGE_DAYS, else the
  // default. A malformed ?days= is rejected rather than silently falling back — a
  // typo'd window that quietly shows something else is worse than an error.
  const envDays = Number(process.env.FLOWWATCH_MAX_AGE_DAYS);
  const configuredDays = Number.isFinite(envDays) && envDays >= 0 ? envDays : DEFAULT_MAX_AGE_DAYS;
  app.get('/api/pipeline', (req, res) => {
    let maxAgeDays = configuredDays;
    if (req.query.days !== undefined) {
      const d = Number(req.query.days);
      if (!Number.isFinite(d) || d < 0) return res.status(400).json({ error: 'days must be a number >= 0' });
      maxAgeDays = d;
    }
    res.json(buildPipeline(db, { maxAgeDays }));
  });

  // Milestone re-tag: files a session under one of the repo's milestones.
  // Valid ids are the repo's MISSION.md milestones (+ literal 'unassigned'), read per request so an edit
  // to the file applies at once — a typo'd id must 400 loudly, not silently tag the session into a
  // milestone nobody rolls up. (repoRoot is set further down, before any request can arrive.)
  app.patch('/api/sessions/:id/milestone', (req, res) => {
    const m = req.body && req.body.milestone;
    if (!m || typeof m !== 'string') return res.status(400).json({ ok: false, error: 'milestone required' });
    const validMilestones = new Set(
      missionOf(repoRoot)
        .milestones.map((x) => x.id)
        .concat('unassigned')
    );
    if (!validMilestones.has(m)) return res.status(400).json({ ok: false, error: 'unknown milestone: ' + m });
    const r = db.prepare('UPDATE sessions SET milestone=? WHERE id=?').run(m, req.params.id);
    if (r.changes === 0) return res.status(404).json({ ok: false, error: 'unknown session' });
    res.json({ ok: true });
  });

  // The repo whose files the panels read. Callers pass it (the `flowwatch` command passes its git top
  // level); without one, the folder the process runs in.
  const repoRoot = opts.repoRoot || process.cwd();
  const repo = {
    repoDir: opts.repoDir || repoRoot,
  };
  // Where this repo keeps what the optional panels read (flowwatch.json), read on every rebuild so an edit shows on the next poll. openspec defaults to its usual folders; explicit
  // options (tests) win over the file. "openspec": false reads nothing, not even a leftover folder, and
  // neither does a file that is broken — it may be the one saying false. The parsers take null as missing.
  /** @typedef {ReturnType<typeof readWiring>} Wiring */
  const openspecOff = (/** @type {Wiring} */ wiring) => Boolean(wiring.config) && wiring.config?.openspec === false;
  const openspecDirs = (/** @type {Wiring} */ wiring) => {
    const none = Boolean(wiring.error) || openspecOff(wiring);
    const o = (wiring.config && wiring.config.openspec) || {};
    return {
      specsDir: opts.specsDir || (none ? null : path.resolve(repoRoot, o.specs || path.join('openspec', 'specs'))),
      changesDir:
        opts.changesDir || (none ? null : path.resolve(repoRoot, o.changes || path.join('openspec', 'changes'))),
    };
  };

  // TTL cache: the mission build shells out to `git log` and walks two directory
  // trees — synchronous work that must NOT run per request with dashboards polling every 2 s
  // while 50+ worktrees POST events into the same event loop. Repo files change on the order
  // of minutes; 30 s staleness is invisible to the operator.
  const MC_TTL_MS = opts.mcTtlMs != null ? opts.mcTtlMs : 30_000;
  /** @type {{at: number, payload: Record<string, any>|null}} */
  let mcCache = { at: 0, payload: null };
  /** @type {Promise<Record<string, any>>|null} one build at a time: polls that arrive during a build wait for it */
  let mcBuilding = null;
  app.get('/api/mission', async (_req, res) => {
    try {
      const now = Date.now();
      if (!mcCache.payload || now - mcCache.at > MC_TTL_MS) {
        mcBuilding =
          mcBuilding ||
          buildMission().finally(() => {
            mcBuilding = null;
          });
        mcCache = { at: now, payload: await mcBuilding };
      }
      res.json(mcCache.payload);
    } catch (e) {
      res.status(500).json({ ok: false, error: /** @type {Error} */ (e).message });
    }
  });

  async function buildMission() {
    const wiring = readWiring(repoRoot);
    const dirs = openspecDirs(wiring);
    const specs = parseSpecsDir(dirs.specsDir);
    const mission = missionOf(repoRoot);
    // A change counts under the category owning the specs it edits, by the lane cards' own lookup.
    const changes = parseChanges(dirs.changesDir, {
      table: ownerTable(mission.categorySpecs),
      inferCategory: inferOf(wiring),
    });
    // Each optional panel is data, not set up, off, or an error. The repo-fed ones run side by side, each
    // command with its own time limit.
    const [stages, ideas, value] = await Promise.all([
      readFeed(repoRoot, wiring, 'stages', checkStages),
      readFeed(repoRoot, wiring, 'ideas', checkIdeas),
      readFeed(repoRoot, wiring, 'value', checkValue),
    ]);
    /** @type {Object<string, import('./feeds').FeedResult>} */
    const panels = { stages, ideas, value };
    panels.specs = opts.specsDir
      ? { state: specs.missing ? 'not-set-up' : 'data' }
      : wiring.error
        ? { state: 'error', reason: value.reason } // the reason every wired panel gives
        : { state: openspecOff(wiring) ? 'off' : specs.missing ? 'not-set-up' : 'data' };
    return buildMissionControl({
      specs,
      changes,
      mission,
      // What this payload was actually built from, so the page names its real sources.
      sources: { mission: mission.file, specs: !specs.missing, changes: !changes.missing, wiring: wiring.file },
      panels: Object.fromEntries(
        Object.entries(panels).map(([k, p]) => [k, { state: p.state, ...(p.reason ? { reason: p.reason } : {}) }])
      ),
      velocity: velocityFromRepo(repo.repoDir),
      // The focus and the milestones are the repo's own, from its MISSION.md.
      config: { focus: mission.focus, milestones: mission.milestones },
      value: value.state === 'data' ? value.data : null,
      stages: stages.state === 'data' ? stages.data : null,
      ideas: ideas.state === 'data' ? ideas.data : null,
    });
  }

  // What is set up for Flowwatch in this repo: the setup banner on both pages
  // and `npx flowwatch check` read this same list. Plus when a live session last reported — from the
  // sessions table (hundreds of rows), not a scan of every event.
  app.get('/api/setup', (_req, res) => {
    try {
      const last = /** @type {{t: number|null}|undefined} */ (
        db.prepare("SELECT MAX(last_seen) AS t FROM sessions WHERE origin = 'live'").get()
      );
      // repoRoot: which repo this collector serves, so `npx flowwatch check` in another repo can tell
      // that the collector on its port is not its own.
      res.json({ ...checkSetup({ repoRoot }), lastEventAt: (last && last.t) || null, repoRoot });
    } catch (e) {
      res.status(500).json({ ok: false, error: /** @type {Error} */ (e).message });
    }
  });

  // Everything waiting on the operator. The walk reads the desktop app's session records and the
  // tail of one transcript per live session — cheap every few seconds, far too expensive per poll,
  // so it is TTL-cached exactly like the mission payload above.
  const inbox = /** @type {InboxOptions} */ (opts.inbox || {});
  // The category inference: one the caller injects (tests), else the module flowwatch.json names, loaded per
  // build so an edit to the file applies (require caches the module itself). Never throws: a broken module
  // infers nothing, and the setup check says why.
  const inferOf = (/** @type {Wiring} */ wiring) =>
    inbox.inferCategory || loadCategorizer(repoRoot, wiring.config).inferCategory;
  // The desktop app's session records: a folder the caller injects (tests), else this platform's, or the one
  // flowwatch.json "sessions.appRecords" names — with where it looked, which the board says when it is not there.
  const recordsOf = (/** @type {Wiring} */ wiring) =>
    inbox.appDir
      ? { dir: inbox.appDir, looked: 'looked in ' + inbox.appDir }
      : appRecordsDir({
          platform: process.platform,
          home: os.homedir(),
          env: process.env,
          repoRoot,
          setting: wiring.config && wiring.config.sessions ? wiring.config.sessions.appRecords : undefined,
        });
  const INBOX_TTL_MS = inbox.ttlMs != null ? inbox.ttlMs : 20_000;
  /** @type {{at: number, payload: object|null}} */
  let inboxCache = { at: 0, payload: null };
  app.get('/api/inbox', (_req, res) => {
    try {
      const now = Date.now();
      if (!inboxCache.payload || now - inboxCache.at > INBOX_TTL_MS) {
        const wiring = readWiring(repoRoot);
        const records = recordsOf(wiring);
        inboxCache = {
          at: now,
          payload: buildInbox(db, {
            appDir: records.dir,
            appLooked: records.looked,
            projectsDir: inbox.projectsDir,
            repoRoot: inbox.repoRoot,
            inferCategory: inferOf(wiring),
            categories: missionOf(repoRoot).categories,
          }),
        };
      }
      res.json(inboxCache.payload);
    } catch (e) {
      res.status(500).json({ ok: false, error: /** @type {Error} */ (e).message });
    }
  });

  // The lane cards: the board's current sessions by category, titled from the app records. Same inputs
  // as the inbox (the app records dir, the canonical repo root, the repo's inference), same TTL rule.
  const LANES_TTL_MS = inbox.ttlMs != null ? inbox.ttlMs : 20_000;
  /** @type {{at: number, payload: object|null}} */
  let lanesCache = { at: 0, payload: null };
  app.get('/api/lanes', (_req, res) => {
    try {
      const now = Date.now();
      if (!lanesCache.payload || now - lanesCache.at > LANES_TTL_MS) {
        const mission = missionOf(repoRoot);
        const wiring = readWiring(repoRoot);
        lanesCache = {
          at: now,
          payload: readLanes(db, {
            appDir: recordsOf(wiring).dir,
            repoRoot: inbox.repoRoot,
            inferCategory: inferOf(wiring),
            now,
            ...openspecDirs(wiring),
            repoDir: repo.repoDir,
            categories: mission.categories,
            categorySpecs: mission.categorySpecs,
            // The repo's cleanup skill; `skillsDir` (tests) moves where it is looked for.
            cleanup: wiring.config ? wiring.config.cleanup : undefined,
            skillsDir: inbox.skillsDir,
            // The board's own window: a card never lists a session the phases detail cannot open.
            windowDays: configuredDays,
          }),
        };
      }
      res.json(lanesCache.payload);
    } catch (e) {
      res.status(500).json({ ok: false, error: /** @type {Error} */ (e).message });
    }
  });

  // The gate queue panel: the repo's gates feed, as it printed it, with the panel's state — or only the
  // state and its reason. Cached briefly, one build at a time: the page polls every 20 s from every open
  // tab, and a feed command should not run once per tab.
  const GATES_TTL_MS = opts.gatesTtlMs != null ? opts.gatesTtlMs : 10_000;
  /** @type {{at: number, payload: object|null}} */
  let gatesCache = { at: 0, payload: null };
  /** @type {Promise<object>|null} */
  let gatesBuilding = null;
  app.get('/api/gates', async (_req, res) => {
    try {
      const now = Date.now();
      if (!gatesCache.payload || now - gatesCache.at > GATES_TTL_MS) {
        gatesBuilding =
          gatesBuilding ||
          readFeed(repoRoot, readWiring(repoRoot), 'gates', checkGates)
            .then((g) => (g.state === 'data' ? { ...g.data, state: 'data' } : g))
            .finally(() => {
              gatesBuilding = null;
            });
        gatesCache = { at: now, payload: await gatesBuilding };
      }
      res.json(gatesCache.payload);
    } catch (e) {
      res.status(500).json({ ok: false, error: /** @type {Error} */ (e).message });
    }
  });

  app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

  // Static dashboards: the collector serves the two approved pages + lib/ assets.
  const publicDir = path.join(__dirname, '..', 'web');
  app.use(express.static(publicDir));
  // Page routes come from the sidebar's own list (web/lib/nav.js), so a panel the sidebar links to
  // always has an address. A bare group address or an unknown panel redirects to the group's first
  // panel, a renamed panel's old address to the panel it became; the bare host lands on Sessions
  // ("Cannot GET /" reads as a broken server).
  const { NAV, LANDING, resolvePanel } = require(path.join(publicDir, 'lib', 'nav.js'));
  for (const g of NAV) {
    const page = path.join(publicDir, g.file);
    app.get(g.base, (_req, res) => res.redirect(g.base + '/' + g.panels[0].id));
    app.get(g.base + '/:panel', (req, res) => {
      const to = resolvePanel(req.path);
      return to.exact ? res.sendFile(page) : res.redirect(g.base + '/' + to.panel.id);
    });
  }
  app.get('/', (_req, res) => res.redirect(LANDING));
  return app;
}

module.exports = { createApp };
