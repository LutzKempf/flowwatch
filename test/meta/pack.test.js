// What `npm install` puts in someone's node_modules: the command, the hooks, the collector, the pages,
// the templates, the demo and the two reference documents. Never the tests or their fixtures, and
// never a built demo site.
const { execFileSync } = require('child_process');
const { ROOT } = require('./repoFiles');

const FOLDERS = ['bin/', 'hooks/', 'server/', 'web/', 'templates/', 'demo/'];
const FILES = [
  'docs/formats.md',
  'docs/settings.md',
  'README.md',
  'SETUP.md',
  'LICENSE',
  'CHANGELOG.md',
  'package.json',
];

// npm is a .cmd script on Windows, which only a shell can start; the arguments are fixed.
const win = process.platform === 'win32';
const packed = JSON.parse(
  execFileSync(win ? 'npm.cmd' : 'npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: win,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
)[0].files.map((f) => f.path.replace(/\\/g, '/'));

test('the package holds only the product folders and the named documents', () => {
  const allowed = (f) => FILES.includes(f) || (FOLDERS.some((d) => f.startsWith(d)) && !f.startsWith('demo/site/'));
  expect(packed.filter((f) => !allowed(f))).toEqual([]);
});

test('the package holds every named document and something from every product folder', () => {
  expect(FILES.filter((f) => !packed.includes(f))).toEqual([]);
  expect(FOLDERS.filter((d) => !packed.some((f) => f.startsWith(d)))).toEqual([]);
});
