#!/usr/bin/env node
// The README's screenshots, taken from the demo as a visitor first sees it: Sessions and the Mission page, at a desktop
// size. The pages have one theme, so there is no light or dark to pick.
//   node demo/screenshots.js [--data <folder>] [--out <folder>]      (npm run screenshots)
// --data is the signed snapshot to build the demo from (default demo/data/), --out where the PNGs go (default
// docs/screenshots/). Needs the dev dependencies: Playwright and its Chromium (npx playwright install chromium).
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');
const { chromium } = require('@playwright/test');
const { serveDemo } = require('./serve');

// Each shot, and what its panel draws once its data is in.
const SHOTS = [
  { file: 'sessions.png', address: 'pipeline.html#sessions', ready: '#lanes[data-titles="loaded"] .lane' },
  { file: 'mission.png', address: 'mission.html#milestones', ready: '#ms-rail .ms' },
];

/**
 * @param {{dataDir: string, outDir: string}} opts
 * @returns {Promise<string[]>} the files written
 */
async function takeScreenshots({ dataDir, outDir }) {
  const site = await serveDemo({ dataDir, port: 0 });
  const browser = await chromium.launch();
  try {
    // A fixed locale and time zone: the board's "as of" time then reads the same from every machine.
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', timezoneId: 'UTC' });
    fs.mkdirSync(outDir, { recursive: true });
    const written = [];
    for (const shot of SHOTS) {
      await page.goto(site.url + shot.address);
      await page.locator(shot.ready).first().waitFor();
      const file = path.join(outDir, shot.file);
      // Animations stopped: the waiting cells pulse, and a shot must not catch them mid-beat.
      await page.screenshot({ path: file, animations: 'disabled' });
      written.push(file);
    }
    return written;
  } finally {
    await browser.close();
    await site.close();
  }
}

module.exports = { takeScreenshots };

if (require.main === module) {
  const { values } = parseArgs({ options: { data: { type: 'string' }, out: { type: 'string' } } });
  const dataDir = path.resolve(values.data || path.join(__dirname, 'data'));
  const outDir = path.resolve(values.out || path.join(__dirname, '..', 'docs', 'screenshots'));
  takeScreenshots({ dataDir, outDir }).then(
    (files) => process.stdout.write(files.map((f) => 'wrote ' + f + '\n').join('')),
    (e) => {
      process.stderr.write(/** @type {Error} */ (e).message + '\n');
      process.exitCode = 1;
    }
  );
}
