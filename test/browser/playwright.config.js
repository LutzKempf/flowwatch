// The browser tier (npm run test:browser): the dashboards as a person sees them, in Chromium. Each spec starts what
// it needs itself, a collector in its own process or a demo site, on a free port, so nothing has to be running first.
// The locale and the time zone are fixed, so no page text depends on the machine the tests run on, and the results
// go to the temp folder, never into the repo.
const os = require('os');
const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: '*.spec.js',
  outputDir: path.join(os.tmpdir(), 'flowwatch-browser-results'),
  reporter: 'list',
  forbidOnly: true,
  use: { locale: 'en-GB', timezoneId: 'UTC' },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
});
