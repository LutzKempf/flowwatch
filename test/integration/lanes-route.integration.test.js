const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { startServer } = require('../../server/server');

let root;
let srv;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-route-'));
});
afterEach(async () => {
  if (srv) {
    await srv.close();
    srv = null;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

// A real git repo, not a mocked `git`: the touch times come from `git log`, and a mock agrees with a
// wrong parser as readily as a right one. Built with `init -b main` and no clone, so neither of the
// fixture traps (bare HEAD on master, CRLF at clone time) applies.
test('the lanes route puts specs and in-flight stories on the category MISSION.md says owns them', async () => {
  const { execFileSync } = require('child_process');
  const repoRoot = path.join(root, 'repo');
  const w = (rel, text) => {
    const p = path.join(repoRoot, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  };
  w(
    'MISSION.md',
    '# Shop\n\nCustomers pay.\n\n## Categories\n- Checkout — specs: checkout-flow, cart-*\n- Reporting — specs: cart-analytics\n'
  );
  w(
    'openspec/specs/checkout-flow.feature',
    'Feature: x\n  @implemented\n  Scenario: a\n  @aspirational\n  Scenario: b\n'
  );
  w('openspec/specs/cart-analytics.feature', 'Feature: y\n  @implemented\n  Scenario: c\n');
  w('openspec/changes/2026-09-14-guest-address-form/proposal.md', '---\nstatus: in-progress\n---\n');
  w('openspec/changes/2026-09-14-guest-address-form/specs/checkout-flow.md', '## ADDED\n');
  w('openspec/changes/2026-09-14-guest-address-form/specs/cart-analytics.md', '## ADDED\n');
  w('flowwatch.json', '{"cleanup": {"skill": "tidy-up"}}');
  const git = (...args) =>
    execFileSync('git', ['-C', repoRoot, '-c', 'core.autocrlf=false', ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t',
      },
    });
  execFileSync('git', ['init', '-q', '-b', 'main', repoRoot]);
  git('add', '-A');
  git('commit', '-q', '--no-verify', '-F', path.join(repoRoot, 'MISSION.md'));

  const skillsDir = path.join(root, 'skills');
  fs.mkdirSync(path.join(skillsDir, 'tidy-up'), { recursive: true });
  fs.writeFileSync(path.join(skillsDir, 'tidy-up', 'SKILL.md'), '---\nname: tidy-up\n---\n');
  srv = await startServer({
    port: 0,
    dbPath: ':memory:',
    watchMs: 0,
    logDir: path.join(root, 'logs'),
    repoRoot,
    inbox: {
      appDir: path.join(root, 'app'),
      projectsDir: path.join(root, 'projects'),
      repoRoot,
      inferCategory: () => null,
      ttlMs: 0,
      skillsDir,
    },
  });
  const body = (await request(`http://127.0.0.1:${srv.port}`).get('/api/lanes')).body;
  expect(body.capability_lanes_from).toBe('categories');
  // What a cleanup hand-off needs: the skill the repo names, whether it is there, and the folder the session opens in.
  expect(body.cleanup_skill).toEqual({ name: 'tidy-up', state: 'installed' });
  expect(body.repo_root).toBe(repoRoot);
  const byName = Object.fromEntries(body.lanes.map((l) => [String(l.name), l]));
  // cart-analytics matches Checkout's `cart-*`, and Reporting owns the exact name: the exact name wins.
  expect(byName.Checkout.specs).toEqual([
    { capability: 'checkout-flow', implemented: 1, total: 2, lane_from: 'categories' },
  ]);
  expect(byName.Reporting.specs.map((s) => s.capability)).toEqual(['cart-analytics']);
  expect(byName.Checkout.stories).toEqual([
    expect.objectContaining({
      topic: '2026-09-14-guest-address-form',
      under: ['checkout-flow'],
      days_since_touched: 0,
    }),
  ]);
  expect(byName.Reporting.stories).toEqual([
    expect.objectContaining({ topic: '2026-09-14-guest-address-form', under: ['cart-analytics'] }),
  ]);
  // A lane with specs and stories but no sessions still has a card.
  expect(byName.Checkout.sessions).toEqual([]);
});

// A checkout whose categories own no spec and that has no git history still answers, and says what it could
// not read, so the page can show the notes instead of silently inferring every lane and listing no story.
test('the lanes route says when no category owns a spec and git history cannot be read', async () => {
  const repoRoot = path.join(root, 'bare');
  fs.mkdirSync(path.join(repoRoot, 'openspec', 'specs'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'openspec', 'changes', '2026-09-14-orphan'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, 'openspec', 'specs', 'order-emails.feature'),
    'Feature: x\n  @implemented\n  Scenario: a\n'
  );
  fs.writeFileSync(
    path.join(repoRoot, 'openspec', 'changes', '2026-09-14-orphan', 'proposal.md'),
    '---\nstatus: proposed\n---\n'
  );
  // A folder that is not a repository: point git at an empty directory above it so it cannot find one.
  const prevCeiling = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = root;
  try {
    srv = await startServer({
      port: 0,
      dbPath: ':memory:',
      watchMs: 0,
      logDir: path.join(root, 'logs'),
      repoRoot,
      inbox: {
        appDir: path.join(root, 'app'),
        projectsDir: path.join(root, 'projects'),
        repoRoot,
        inferCategory: (s) => (/email/.test(String(s)) ? 'Notifications' : null),
        ttlMs: 0,
        skillsDir: path.join(root, 'no-skills'),
      },
    });
    const body = (await request(`http://127.0.0.1:${srv.port}`).get('/api/lanes')).body;
    expect(body.capability_lanes_from).toBe('inference only');
    expect(body.stories_touched_from).toBe('unavailable');
    const notifications = body.lanes.find((l) => l.name === 'Notifications');
    expect(notifications.specs).toEqual([
      { capability: 'order-emails', implemented: 1, total: 1, lane_from: 'inferred' },
    ]);
    // No known touch: counted as older and listed for Cleanup, never shown as in flight.
    const all = body.lanes.flatMap((l) => l.older.map((c) => c.topic));
    expect(all).toContain('2026-09-14-orphan');
    expect(body.lanes.flatMap((l) => l.stories)).toEqual([]);
  } finally {
    if (prevCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = prevCeiling;
  }
});

test("the lanes route puts the board's sessions in lanes, titled from their app records", async () => {
  const repoRoot = path.join(root, 'repo');
  const appDir = path.join(root, 'app');
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.mkdirSync(appDir, { recursive: true });
  // The repo declares its categories (MISSION.md), and is the collector's own checkout too: nothing from
  // the repo the tests run in reaches this route.
  fs.writeFileSync(
    path.join(repoRoot, 'MISSION.md'),
    '# Test\n\nA repo for the lanes route.\n\n## Categories\nRetro\n'
  );
  fs.writeFileSync(path.join(repoRoot, 'flowwatch.json'), '{"cleanup": {"skill": "tidy-up"}}');
  const now = Date.now();
  fs.writeFileSync(
    path.join(appDir, 'local_1.json'),
    JSON.stringify({
      sessionId: 'local_1',
      cliSessionId: 'cli-1',
      cwd: path.join(repoRoot, '.claude', 'worktrees', 'wt-a'),
      title: 'Retro: close the guard',
      branch: 'claude/guard',
      lastActivityAt: now,
    })
  );

  srv = await startServer({
    port: 0,
    dbPath: ':memory:',
    watchMs: 0,
    logDir: path.join(root, 'logs'),
    repoRoot,
    inbox: {
      appDir,
      projectsDir: path.join(root, 'projects'),
      repoRoot,
      inferCategory: () => null,
      ttlMs: 0,
      skillsDir: path.join(root, 'skills-without-it'),
    },
  });
  const api = request(`http://127.0.0.1:${srv.port}`);
  for (const [sid, wt] of [
    ['cli-1', 'wt-a'],
    ['cli-2', 'wt-b'],
  ]) {
    await api
      .post('/events')
      .send({ id: `e-${sid}`, session_id: sid, worktree: wt, ts: now - 60000, type: 'session_start' })
      .expect(200);
  }

  const body = (await api.get('/api/lanes')).body;
  expect(body.sources).toEqual({ app_records: 'ok' });
  expect(body.cleanup_skill).toEqual({ name: 'tidy-up', state: 'missing' });
  const byName = Object.fromEntries(body.lanes.map((l) => [String(l.name), l]));
  expect(byName.Retro.sessions.map((s) => [s.id, s.title, s.app_session_id])).toEqual([
    ['cli-1', 'Retro: close the guard', 'local_1'],
  ]);
  // cli-2 has no app record: counted, not laned, so every board session is accounted for.
  expect(byName.null).toBeUndefined();
  expect(body.without_app_record).toBe(1);
  for (const l of body.lanes) {
    expect(l.totals).toEqual(expect.objectContaining({ work_ms: expect.any(Number), tokens: expect.any(Number) }));
  }
});
