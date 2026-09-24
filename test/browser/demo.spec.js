// Row 13: the static demo, built from the signed fixture snapshot into a temp folder and served as plain files under
// /flowwatch/, the way GitHub Pages serves it (demo/serve.js). What a visitor sees: it opens on Sessions and says what
// it is, every panel is filled from the snapshot, panels switch and survive a reload, the clock stands at the
// snapshot's moment, nothing leads off the site or into the Claude app, and a phone gets no sideways scroll.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { serveDemo } = require('../../demo/serve');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'demo');
const data = (/** @type {string} */ name) => JSON.parse(fs.readFileSync(path.join(FIXTURE, name + '.json'), 'utf8'));
const mission = data('mission');
const inbox = data('inbox');
const lanes = data('lanes');
const gates = data('gates');
// The board's rows: every session with an app title. A title's category prefix is dropped on the row, as its
// category is shown beside it.
const ROWS = Object.values(lanes.titles).map((t) => t.title.replace(/^\w+: /, ''));

/** @type {{url: string, close: () => Promise<void>}} */
let site;
test.beforeAll(async () => {
  site = await serveDemo({ dataDir: FIXTURE, port: 0 });
});
test.afterAll(async () => {
  await site.close();
});

const panel = (/** @type {import('@playwright/test').Page} */ page, /** @type {string} */ id) =>
  page.locator(`[data-panel="${id}"]`);
const boardLoaded = (/** @type {import('@playwright/test').Page} */ page) =>
  expect(page.locator('#lanes[data-titles="loaded"] .lane')).toHaveCount(ROWS.length);

test('the site opens on Sessions, with the demo banner and its one-line orientation', async ({ page }) => {
  await page.goto(site.url);
  await expect(page).toHaveURL(/\/flowwatch\/pipeline\.html#sessions$/);
  await expect(page.locator('#demo-banner')).toHaveText(
    "Demo: a snapshot of checkout's dashboards on 21 September 2026. Nothing you click is saved."
  );
  await expect(page.locator('.demo-orient')).toHaveText(
    "Each row is an AI agent's session; the top rows are waiting on a person."
  );
  await expect(panel(page, 'sessions')).toBeVisible();
  await expect(panel(page, 'gates')).toBeHidden();
  // The setup banner asks the visitor to set Flowwatch up in a repo of their own: the demo removes it.
  await expect(page.locator('#setup-banner')).toHaveCount(0);
});

test('every panel is filled from the snapshot files, Specs included', async ({ page }) => {
  await page.goto(site.url + 'pipeline.html#sessions');
  await boardLoaded(page);
  for (const title of ROWS) await expect(page.locator('#lanes')).toContainText(title);
  await expect(page.locator('#waiting-n')).toHaveText(String(inbox.items.length));

  await page.goto(site.url + 'pipeline.html#gates');
  await expect(page.locator('#gates .gq-meta')).toHaveText(
    `${gates.running.length} running · ${gates.waiting.length} waiting`
  );
  for (const g of [...gates.running, ...gates.waiting]) await expect(page.locator('#gates')).toContainText(g.branch);

  await page.goto(site.url + 'mission.html#milestones');
  await expect(page.locator('#mission-title')).toHaveText('Mission: ' + mission.mission.title);
  await expect(page.locator('#ms-rail .ms .t')).toHaveText(mission.milestones.map((m) => m.title));
  await expect(page.locator('#verdict .flag')).toHaveCount(mission.value.figures.length);
  await expect(page.locator('[data-bind="total"]')).toHaveText(String(mission.totals.total));

  await page.goto(site.url + 'mission.html#stages');
  await expect(page.locator('#lc-grid .lcname b')).toHaveText(mission.stages.workstreams.map((w) => w.name));

  await page.goto(site.url + 'mission.html#ideas');
  await expect(page.locator('#ideas .idsec > summary b')).toHaveText(mission.ideas.sections.map((s) => s.title));

  await page.goto(site.url + 'mission.html#specs');
  const caps = Object.entries(mission.capabilities);
  await expect(page.locator('#spec-bars .nm')).toHaveText(caps.map(([name]) => name));
  await expect(page.locator('#spec-bars .pct')).toHaveText(caps.map(([, c]) => `${c.implemented}/${c.total}`));
});

test('the sidebar switches panels, and a reload on a panel address shows that panel', async ({ page }) => {
  await page.goto(site.url + 'pipeline.html#sessions');
  await page.getByRole('link', { name: 'Gate pipeline' }).click();
  await expect(page).toHaveURL(/pipeline\.html#gates$/);
  await expect(panel(page, 'gates')).toBeVisible();
  await expect(panel(page, 'sessions')).toBeHidden();
  await page.reload();
  await expect(panel(page, 'gates')).toBeVisible();
  await expect(panel(page, 'sessions')).toBeHidden();
  await expect(page.locator('#nav [aria-current="page"]')).toHaveAttribute('data-nav', 'gates');

  // The other page is a page load; its panels then switch in place, and each survives a reload.
  await page.getByRole('link', { name: 'Milestones and stats' }).click();
  await expect(page).toHaveURL(/mission\.html#milestones$/);
  await expect(panel(page, 'milestones')).toBeVisible();
  for (const [id, label] of [
    ['stages', 'Stages'],
    ['ideas', 'Ideas'],
    ['specs', 'Specs'],
  ]) {
    await page.getByRole('link', { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`mission\\.html#${id}$`));
    await page.reload();
    await expect(panel(page, id)).toBeVisible();
    await expect(page.locator('[data-panel]:visible')).toHaveCount(1);
    await expect(page).toHaveTitle('Flowwatch — ' + label);
  }

  await page.getByRole('link', { name: 'Sessions' }).click();
  await expect(page).toHaveURL(/pipeline\.html#sessions$/);
  await expect(panel(page, 'sessions')).toBeVisible();
});

test("the clock stands at the snapshot's moment, whatever the machine's clock says", async ({ page }) => {
  // Years after the snapshot: a page reading the real clock would say every gate has run for days.
  await page.clock.setFixedTime(new Date('2031-05-01T09:00:00Z'));
  await page.goto(site.url + 'pipeline.html#gates');
  await expect(page.locator('#gates .gq-run .gq-time')).toHaveText('running 3h 54m');
  await expect(page.locator('#gates .gq-item .gq-time')).toHaveText(['waiting 3h 47m', 'waiting 3h 43m']);
  await expect(page.locator('#gates')).not.toContainText('not updated');
  await expect(page.locator('#footer-source')).toHaveText('A snapshot taken 2026-09-21 · no live data');

  // A session the board lists without an inbox entry is aged by the page's clock: seen minutes before the snapshot.
  await page.getByRole('link', { name: 'Sessions' }).click();
  await boardLoaded(page);
  await page.locator('[data-view="cleanup"]').click();
  await expect(page.locator('.tr-clean-row', { hasText: 'Speed up the test suite' }).locator('.when')).toHaveText(
    'just now'
  );

  await page.goto(site.url + 'mission.html#milestones');
  await expect(page.locator('#mc-sources')).toContainText(' · a snapshot taken 2026-09-21');
});

test('clicks stay in the browser: no link into the Claude app, nothing leaves the site', async ({ page }) => {
  const origin = new URL(site.url).origin;
  /** @type {string[]} */
  const requested = [];
  /** @type {string[]} */
  const visited = [];
  page.on('request', (r) => requested.push(r.url()));
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) visited.push(f.url());
  });
  /** Every link on the page, resolved. */
  const hrefs = () => page.locator('a[href]').evaluateAll((as) => as.map((a) => /** @type {any} */ (a).href));

  await page.goto(site.url + 'pipeline.html#sessions');
  await boardLoaded(page);
  // A row's title is text in the demo: clicking it selects the row and stays on the page.
  for (const title of ROWS) {
    await page.locator('#lanes .lane').filter({ hasText: title }).locator('.lname b').click();
    await expect(page.locator('#d-name')).toHaveText(title);
  }
  await expect(page).toHaveURL(site.url + 'pipeline.html#sessions');
  await page.locator('[data-view="cleanup"]').click();
  await page.locator('[data-pick-all]').check();
  await page.getByRole('button', { name: 'Close selected…' }).click();
  const handoff = page.getByRole('region', { name: 'Hand off to a cleanup session' });
  await expect(handoff).toContainText('No link:');
  await expect(handoff.getByRole('link')).toHaveCount(0);
  const links = await hrefs();
  await page.goto(site.url + 'pipeline.html#gates');
  await expect(page.locator('#gates .gq-sec').first()).toBeVisible();
  links.push(...(await hrefs()));
  await page.goto(site.url + 'mission.html#milestones');
  await expect(page.locator('#ms-rail .ms').first()).toBeVisible();
  links.push(...(await hrefs()));

  expect(links.length).toBeGreaterThan(0);
  expect(links.filter((h) => !h.startsWith(site.url))).toEqual([]);
  expect(requested.filter((u) => !u.startsWith(origin + '/flowwatch/'))).toEqual([]);
  expect(visited.filter((u) => !u.startsWith(site.url))).toEqual([]);
});

// A column removed from a header but not from the rows (or the other way round) shifts every value one place
// left: the numbers still look like numbers, under the wrong headings, and nothing throws.
test('every table says as many things as its headings promise', async ({ page }) => {
  await page.goto(site.url);
  await boardLoaded(page);
  await page.locator('.lane').first().click();
  await expect(page.locator('.detail table thead th').first()).toBeVisible();

  const mismatches = await page.$$eval('table', (tables) =>
    tables
      .filter((t) => t.querySelector('thead th') && t.querySelector('tbody tr td'))
      .flatMap((t) => {
        const headings = t.querySelectorAll('thead th').length;
        return [...t.querySelectorAll('tbody tr')]
          .filter((r) => r.querySelectorAll('td').length && r.querySelectorAll('td').length !== headings)
          .map(
            (r) =>
              `${[...t.querySelectorAll('thead th')].map((h) => h.textContent.trim()).join('|')}: a row has ${r.querySelectorAll('td').length} cells for ${headings} headings`
          );
      })
  );
  expect(mismatches).toEqual([]);
});

test.describe('at phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the first view has no sideways scroll', async ({ page }) => {
    await page.goto(site.url);
    await expect(page).toHaveURL(/pipeline\.html#sessions$/);
    await boardLoaded(page);
    const overflow = await page.locator('html').evaluate((html) => html.scrollWidth - html.clientWidth);
    expect(overflow).toBe(0);
  });
});
