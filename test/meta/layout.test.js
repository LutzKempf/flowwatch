// The repo's shape, as a stranger first sees it: a short, known top level, no folder that exists for
// a single file, and paths short enough to read in a listing.
const path = require('path');
const { repoFiles } = require('./repoFiles');

const TOP_FILES = [
  'README.md',
  'SETUP.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'LICENSE',
  'package.json',
  'package-lock.json',
  '.gitignore',
  '.gitattributes',
  '.npmrc',
  'eslint.config.js',
  '.prettierrc.json',
  '.prettierignore',
  'tsconfig.json',
];
// Each of these may be missing; nothing else may be there.
const TOP_FOLDERS = ['bin', 'hooks', 'server', 'web', 'demo', 'templates', 'docs', 'test', '.github'];
const MAX_PATH = 80;

const files = repoFiles();

test('the top level holds exactly the known files', () => {
  const top = files.filter((f) => !f.includes('/'));
  expect(top.sort()).toEqual([...TOP_FILES].sort());
});

test('the top level holds no folder outside the known list', () => {
  const folders = new Set(files.filter((f) => f.includes('/')).map((f) => f.split('/')[0]));
  expect([...folders].filter((d) => !TOP_FOLDERS.includes(d))).toEqual([]);
});

test('no folder outside test/fixtures/ holds exactly one file', () => {
  const perFolder = {};
  for (const f of files) {
    const dir = path.posix.dirname(f);
    perFolder[dir] = (perFolder[dir] || 0) + 1;
  }
  const lone = Object.keys(perFolder).filter((d) => perFolder[d] === 1 && !`${d}/`.startsWith('test/fixtures/'));
  expect(lone).toEqual([]);
});

test(`no path is longer than ${MAX_PATH} characters`, () => {
  expect(files.filter((f) => f.length > MAX_PATH)).toEqual([]);
});
