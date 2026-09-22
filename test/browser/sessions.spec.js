// Row 7: the Sessions board's Cleanup hand-off. A repo that names its cleanup skill (flowwatch.json "cleanup":
// {"skill": ...}) gets a hand-off that names that skill and a link that opens a session running it; a repo that names
// none gets the list to copy, and no link at all. The skill name is made up here, so a page that printed any name of
// its own would fail. The link is read, never followed: it would open the Claude app.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { startCollector } = require('./collector');

const SKILL = 'sweep-finished-work';
const TITLE = 'Tidy the release notes';

/**
 * A repo with one session waiting on the operator, and the flowwatch.json given.
 * @param {string} root
 * @param {object|null} settings
 */
function repoWith(root, settings) {
  const repoRoot = path.join(root, 'repo');
  fs.mkdirSync(repoRoot);
  fs.writeFileSync(
    path.join(repoRoot, 'MISSION.md'),
    '# Release notes people read\n\nEvery release says what changed.\n'
  );
  if (settings) fs.writeFileSync(path.join(repoRoot, 'flowwatch.json'), JSON.stringify(settings));
  return repoRoot;
}

/**
 * Opens Cleanup, picks the one session and presses "Close selected…".
 * @param {import('@playwright/test').Page} page
 * @param {string} url
 */
async function openHandoff(page, url) {
  await page.goto(url + '/pipeline/sessions');
  await expect(page.locator('#lanes[data-titles="loaded"] .lane')).toHaveCount(1);
  await page.locator('[data-view="cleanup"]').click();
  await page.getByRole('checkbox', { name: TITLE }).check();
  await page.getByRole('button', { name: 'Close selected…' }).click();
  return page.getByRole('region', { name: 'Hand off to a cleanup session' });
}

for (const named of [true, false]) {
  test.describe(named ? 'a repo that names its cleanup skill' : 'a repo that names no cleanup skill', () => {
    /** @type {{url: string, close: () => Promise<void>}} */
    let site;
    let root = '';
    let repoRoot = '';
    test.beforeAll(async () => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-sessions-'));
      repoRoot = repoWith(root, named ? { cleanup: { skill: SKILL } } : null);
      site = await startCollector({
        repoRoot,
        sessions: [{ id: 'notes', title: TITLE, ask: 'The notes are merged. Shall I close this session?' }],
        skills: [SKILL],
      });
    });
    test.afterAll(async () => {
      await site.close();
      fs.rmSync(root, { recursive: true, force: true });
    });

    if (named) {
      test('the hand-off names the skill and links to a session running it in the repo folder', async ({ page }) => {
        const handoff = await openHandoff(page, site.url);
        await expect(page.locator('#triage')).toContainText(
          `Closing hands what you pick to a new session running /${SKILL}. Nothing is closed from this page.`
        );
        await expect(handoff.getByRole('heading')).toHaveText('Hand 1 session to a cleanup session');
        await expect(handoff).toContainText(`with this list typed in after /${SKILL}.`);
        await expect(handoff.locator('pre')).toHaveText(
          new RegExp(`^/${SKILL}\\n\\nSessions:\\n- ${TITLE} · app session local_notes · `)
        );
        const link = handoff.getByRole('link', { name: `Open a session running /${SKILL}` });
        await expect(link).toHaveAttribute('href', /^claude:\/\/code\/new\?q=/);
        const href = new URL(/** @type {string} */ (await link.getAttribute('href')));
        expect(href.searchParams.get('q')).toMatch(new RegExp(`^/${SKILL}\\n`));
        expect(href.searchParams.get('folder')).toBe(repoRoot);
      });
    } else {
      test('the hand-off offers the list to copy, and no link', async ({ page }) => {
        const handoff = await openHandoff(page, site.url);
        await expect(page.locator('#triage')).toContainText(
          'No cleanup skill is named for this repo, so closing gives you the list to copy into a session of your own.'
        );
        await expect(handoff).toContainText('No cleanup skill is named for this repo, so there is no session to open');
        // The list is open to copy, and starts with the list itself, not a skill to run.
        await expect(handoff.getByText('The list to copy')).toBeVisible();
        await expect(handoff.locator('pre')).toBeVisible();
        await expect(handoff.locator('pre')).toHaveText(
          new RegExp(`^Sessions:\\n- ${TITLE} · app session local_notes · `)
        );
        await expect(handoff).toContainText(
          'No link: no cleanup skill is named for this repo. Copy the list into a session in that folder.'
        );
        await expect(handoff.getByRole('link')).toHaveCount(0);
        await expect(page.locator('a[href^="claude://code/new"]')).toHaveCount(0);
      });
    }
  });
}
