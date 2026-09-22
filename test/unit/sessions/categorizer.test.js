// A repo may name its own category inference in flowwatch.json ("sessions": { "categorize": "<path>" }): a
// module exporting inferCategory(branch, title). Without it, categories come from the title rule only. A module
// that is missing, throws or throws later costs the inferred categories and nothing else.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadCategorizer } = require('../../../server/sessions/categorizer');

const FIXTURE = path.join(__dirname, '..', '..', 'fixtures', 'repo');
const repoWith = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'categorize-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
};
const setting = (categorize) => ({ sessions: { categorize } });

test('the module flowwatch.json names infers the category from the branch and the title', () => {
  const c = loadCategorizer(FIXTURE, setting('scripts/categorize.js'));
  expect(c).toMatchObject({ state: 'ok', detail: 'infers the rest with scripts/categorize.js' });
  expect(c.inferCategory('claude/basket-page', 'Tidy the page')).toBe('Checkout');
  expect(c.inferCategory(null, 'Wording of the receipt email')).toBe('Notifications');
});

test('with no module named, categories come from the title rule only, and that is not a problem', () => {
  for (const config of [null, {}, { sessions: {} }]) {
    const c = loadCategorizer(FIXTURE, config);
    expect(c.state).toBe('ok');
    expect(c.detail).toMatch(/^from session titles only/);
    expect(c.inferCategory('claude/basket-page', 'Tidy the basket')).toBeNull();
  }
});

test.each([
  ['a module that is not there', {}, 'scripts/gone.js', 'names scripts/gone.js, which is not there'],
  [
    'a module that throws on load',
    { 'scripts/c.js': 'throw new Error("no config here");' },
    'scripts/c.js',
    'scripts/c.js could not be loaded: no config here',
  ],
  [
    'a module with no inferCategory',
    { 'scripts/c.js': 'module.exports = { guess() {} };' },
    'scripts/c.js',
    'scripts/c.js does not export inferCategory(branch, title)',
  ],
  [
    'a setting that is not a path',
    {},
    42,
    '"sessions.categorize" must be a path in the repo, such as "scripts/categorize.js"',
  ],
])('%s is a problem the setup check names, and infers nothing', (_what, files, rel, detail) => {
  const c = loadCategorizer(repoWith(files), setting(rel));
  expect(c).toMatchObject({ state: 'problem', detail });
  expect(c.inferCategory('claude/basket-page', 'Tidy the basket')).toBeNull();
});

test('an inferCategory that throws when called infers nothing, instead of failing the request', () => {
  const dir = repoWith({ 'scripts/c.js': 'module.exports = { inferCategory() { throw new Error("bad input"); } };' });
  const c = loadCategorizer(dir, setting('scripts/c.js'));
  expect(c.state).toBe('ok');
  expect(c.inferCategory('claude/x', 'y')).toBeNull();
});

test('a module answering with an object gives its category as a plain name, so lanes and the inbox agree', () => {
  const dir = repoWith({
    'c.js':
      'exports.inferCategory = (branch) => ({ rich: { category: "Checkout", from: "branch" }, ' +
      'empty: {}, number: 42, blank: "  " })[branch];',
  });
  const c = loadCategorizer(dir, setting('c.js'));
  expect(['rich', 'empty', 'number', 'blank'].map((b) => c.inferCategory(b, ''))).toEqual([
    'Checkout',
    null,
    null,
    null,
  ]);
});
