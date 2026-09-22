// With no repoRoot, createApp() reads the repo the process runs in (process.cwd()), and an explicit repoRoot
// always wins. The `flowwatch` command passes the repo it serves; anything else gets its cwd. Reading the
// checkout the module sits in instead would, for an installed package, read node_modules/flowwatch.
//
// A test that supplies the value under test is not testing it: passing `repoRoot`
// explicitly exercises only the path that cannot break, and stays green while
// `createApp(db)` with no options resolves everything against the wrong folder.
//
// So: the no-repoRoot cases pass no options at all, and create the app from inside a
// temp repo that is neither this checkout nor the module's folder. That is the only
// arrangement in which a cwd default is distinguishable from a module-relative one.
const request = require('supertest');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { openDb } = require('../../server/db');
const { createApp } = require('../../server/collector');

// A git fixture must not inherit the GIT_* variables of whatever process runs the tests.
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

describe('with no repoRoot, repo paths resolve from the folder the process runs in', () => {
  let repo;

  // A made-up repo with all four sources: a stages feed (wired in its flowwatch.json), openspec
  // specs and changes, and a git history with one merged pull request.
  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cwd-repo-'));
    fs.cpSync(path.join(__dirname, '..', 'fixtures', 'repo'), repo, { recursive: true });
    const git = (...args) =>
      execFileSync(
        'git',
        ['-c', 'user.name=fixture', '-c', 'user.email=fixture', '-c', 'commit.gpgsign=false', ...args],
        { cwd: repo, env: cleanEnv(), stdio: 'ignore' }
      );
    git('init', '-q');
    git('add', '-A');
    git('commit', '-q', '-m', 'Add guest checkout (#1)');
  });

  afterAll(() => {
    try {
      fs.rmSync(repo, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  // process.chdir is worker-wide, so the cwd is put back before anything else can run: the app takes
  // its repo when it is created, and a later suite must not stand in a folder this one deletes.
  function appCreatedIn(dir, opts) {
    const before = process.cwd();
    try {
      process.chdir(dir);
      return opts ? createApp(openDb(':memory:'), opts) : createApp(openDb(':memory:'));
    } finally {
      process.chdir(before);
    }
  }

  test('the stages grid is populated with NO repoRoot passed', async () => {
    const app = appCreatedIn(repo); // <- deliberately no options
    const res = await request(app).get('/api/mission').expect(200);

    // "Workstreams were found" is the deliverable. An empty array is exactly what a
    // wrong folder produces, and a 200 does not distinguish it from success.
    expect(res.body.stages.workstreams.length).toBeGreaterThan(0);
  });

  test('spec capabilities resolve too, rather than 500ing the payload', async () => {
    // A missing specs dir throws inside parseSpecsDir and takes the WHOLE payload
    // down, so this is the louder half of the same failure.
    const app = appCreatedIn(repo);
    const res = await request(app).get('/api/mission').expect(200);
    expect(Object.keys(res.body.capabilities).length).toBeGreaterThan(0);
  });

  test('ALL four repo paths resolve, not just the two with loud failures', async () => {
    // Asserting a subset is how the previous version of this file stayed green.
    // repoDir in particular fails SOFTLY — velocityFromRepo catches the git error
    // and returns zeros — so a wrong repoDir prints a confident "0 PRs" in
    // the hero rather than surfacing anything.
    const app = appCreatedIn(repo);
    const res = await request(app).get('/api/mission').expect(200);

    expect(res.body.stages.workstreams.length).toBeGreaterThan(0); // the stages feed file
    expect(Object.keys(res.body.capabilities).length).toBeGreaterThan(0); // specsDir
    expect(res.body.velocity.totalPRs).toBeGreaterThan(0); // repoDir (fail-soft!)
    expect(res.body.archivedChanges).toBeGreaterThan(0); // changesDir
  });

  test('an explicit repoRoot wins over the folder the process runs in', async () => {
    const named = fs.mkdtempSync(path.join(os.tmpdir(), 'named-repo-'));
    try {
      const app = appCreatedIn(repo, { repoRoot: named });
      const res = await request(app).get('/api/mission').expect(200);
      expect(res.body.stages).toBeNull();
      expect(res.body.capabilities).toEqual({});
      expect(res.body.archivedChanges).toBe(0);
      expect(res.body.mission.file).toBeNull();
    } finally {
      fs.rmSync(named, { recursive: true, force: true });
    }
  });

  // Deliberately NOT asserted here: which workstreams exist, or that warnings is empty.
  // Both couple a path test to repo content, so an unrelated malformed feed row
  // would red it and the next reader would learn nothing about paths.
});
