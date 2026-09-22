// Row 2: a repo with nothing in it yet opens on the setup page. It says what is missing (the mission and the session
// hooks first, then every optional panel as not set up), and shows nothing of any other repo on the machine: another
// repo's session waits in the same app records folder, and must not reach this board.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { startCollector } = require('./collector');

const OTHER_TITLE = 'Billing: refund the duplicate charge';

/** @type {{url: string, close: () => Promise<void>}} */
let site;
let root = '';
const ceiling = process.env.GIT_CEILING_DIRECTORIES;
test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-new-repo-'));
  const repoRoot = path.join(root, 'repo');
  fs.mkdirSync(repoRoot);
  // git must not find a repository above the temp folder and read its history as this repo's.
  process.env.GIT_CEILING_DIRECTORIES = root;
  site = await startCollector({
    repoRoot,
    sessions: [
      {
        id: 'other',
        title: OTHER_TITLE,
        ask: 'Shall I merge the refund fix?',
        cwd: path.join(root, 'other-repo', '.claude', 'worktrees', 'refunds'),
      },
    ],
  });
});
test.afterAll(async () => {
  await site.close();
  if (ceiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
  else process.env.GIT_CEILING_DIRECTORIES = ceiling;
  fs.rmSync(root, { recursive: true, force: true });
});

test('the setup banner lists the mission and the hooks as missing, then every optional panel', async ({ page }) => {
  await page.goto(site.url + '/mission/milestones');
  const banner = page.locator('#setup-banner');
  await expect(banner).toContainText('Flowwatch is not fully set up in this repo.');
  await expect(banner.locator('li')).toHaveText([
    'The mission (MISSION.md): no MISSION.md at the repo root or in docs/ (step 3 Write the mission)',
    'Session tracking hooks: no hook in .claude/settings.json or settings.local.json runs the Flowwatch emitter (step 5 Session tracking)',
    'optional Stages panel: not in flowwatch.json (step 4 Optional panels)',
    'optional Ideas panel: not in flowwatch.json (step 4 Optional panels)',
    'optional Value figures: not in flowwatch.json (step 4 Optional panels)',
    'optional Gates panel: not in flowwatch.json (step 4 Optional panels)',
    'optional Specs (openspec): no openspec/specs folder (optional) (step 4 Optional panels)',
  ]);
});

test('the Mission page says there is no mission yet, and counts nothing', async ({ page }) => {
  await page.goto(site.url + '/mission/milestones');
  await expect(page.locator('#mission-title')).toHaveText('No mission yet');
  await expect(page.locator('#mission-statement')).toContainText('step 3 “Write the mission”');
  await expect(page.locator('#ms-rail')).toContainText('No milestones yet.');
  // No spec, no change and no merged pull request: nothing of another repo's history stands in for this one's.
  await expect(page.locator('[data-bind="total"]')).toHaveText('0');
  await expect(page.locator('[data-bind="active-changes"]')).toHaveText('0');
  await expect(page.locator('[data-bind="prs-week"]')).toHaveText('0');
});

test('every optional panel says it is not set up', async ({ page }) => {
  await page.goto(site.url + '/mission/milestones');
  await expect(page.locator('#verdict')).toHaveText(
    'value figures are not set up in this repo (the Flowwatch SETUP.md, step 4)'
  );
  const notSetUp = 'Not set up in this repo.';
  await page.getByRole('link', { name: 'Stages' }).click();
  await expect(page.locator('#lc-warn')).toContainText(notSetUp);
  await expect(page.locator('#lc-grid')).toBeEmpty();
  await page.getByRole('link', { name: 'Ideas' }).click();
  await expect(page.locator('#ideas-sum')).toContainText(notSetUp);
  await page.getByRole('link', { name: 'Specs' }).click();
  await expect(page.locator('#spec-bars')).toHaveText(
    'No specs yet. This panel counts the scenarios in openspec/specs, and this repo has no such folder. Specs are optional.'
  );
  await page.getByRole('link', { name: 'Gate pipeline' }).click();
  await expect(page.locator('#gates .gq-meta')).toHaveText('not set up');
  await expect(page.locator('#gates')).toContainText(notSetUp);
});

test("the Sessions board says no session has reported and the hooks are missing, and shows no other repo's session", async ({
  page,
}) => {
  await page.goto(site.url + '/pipeline/sessions');
  await expect(page.locator('#lanes .empty')).toHaveText(
    'No session has reported yet. Session tracking is not installed in this repo: ask your agent to follow the ' +
      'Flowwatch SETUP.md, step 5 “Session tracking”.'
  );
  await expect(page.locator('#waiting-n')).toHaveText('0');
  await expect(page.locator('#triage')).toContainText('0 of 0 sessions shown');
  // Both reads are in (the empty board needs the setup and the inbox), so the absence below is a finding.
  await expect(page.locator('body')).not.toContainText('refund');
});
