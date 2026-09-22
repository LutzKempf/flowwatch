// Row 20: every panel of both pages has no serious or critical axe-core violation, on the live dashboard and on the
// static demo build. A panel is scanned once its data is drawn: an empty panel passes rules a filled one can fail.
// The live collector serves the fixture repo, which fills every panel and leaves the setup banner up (it has no
// hooks), with one session waiting on the operator.
const path = require('path');
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { NAV, hrefOf } = require('../../web/lib/nav');
const { serveDemo } = require('../../demo/serve');
const { startCollector } = require('./collector');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

// What each panel draws once its data is in.
const READY = {
  milestones: '#ms-rail .ms',
  stages: '#lc-grid .lcname',
  ideas: '#ideas .idsec',
  specs: '#spec-bars .bar',
  sessions: '#lanes[data-titles="loaded"] .lane',
  gates: '#gates .gq-sec',
};

/** @param {import('@playwright/test').Page} page */
async function seriousViolations(page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

const SITES = {
  'the live dashboard': {
    start: async () => {
      const c = await startCollector({
        repoRoot: path.join(FIXTURES, 'repo'),
        sessions: [
          { id: 'a11y', title: 'Checkout: Add the guest address form', ask: 'Shall I open the pull request?' },
        ],
      });
      return { base: c.url + '/', close: c.close };
    },
    demo: false,
  },
  'the demo': {
    start: async () => {
      const d = await serveDemo({ dataDir: path.join(FIXTURES, 'demo'), port: 0 });
      return { base: d.url, close: d.close };
    },
    demo: true,
  },
};

for (const [name, site] of Object.entries(SITES)) {
  test.describe(name, () => {
    /** @type {{base: string, close: () => Promise<void>}} */
    let s;
    test.beforeAll(async () => {
      s = await site.start();
    });
    test.afterAll(async () => {
      await s.close();
    });

    // On a desktop, and at phone width, where wide boards and tables scroll inside their own boxes.
    for (const viewport of [null, { width: 390, height: 844 }]) {
      test.describe(viewport ? 'at phone width' : 'on a desktop', () => {
        if (viewport) test.use({ viewport });
        for (const g of NAV) {
          for (const p of g.panels) {
            test(`${g.group} → ${p.label} has no serious or critical accessibility violation`, async ({ page }) => {
              await page.goto(s.base + hrefOf(g, p, site.demo).replace(/^\//, ''));
              await expect(page.locator(READY[p.id]).first()).toBeVisible();
              // Live, the fixture repo's setup banner is part of every page; the demo takes it away.
              if (!site.demo) await expect(page.locator('#setup-banner')).toBeVisible();
              expect(await seriousViolations(page)).toEqual([]);
            });
          }
        }
      });
    }
  });
}
