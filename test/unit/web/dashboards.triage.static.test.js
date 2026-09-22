const { ownFiles, pageFile } = require('./pageFiles');

const P = 'pipeline.html';
const page = pageFile(P, P);
const file = (name) => pageFile(P, 'pages/pipeline/' + name);
// Everything the page is made of, for what must appear nowhere on it.
const whole = ownFiles(P)
  .map(([, text]) => text)
  .join('\n');

test('the page loads the triage rules it renders with', () => {
  expect(page).toContain('src="/lib/triage.js"');
  expect(file('rows.js')).toContain('Triage.rowsFrom');
  expect(file('rows.js')).toContain('Triage.boardItems');
  expect(file('board.js')).toContain('Triage.BOARD_GROUPS');
});

test('the inbox has a place on the page', () => {
  expect(page).toContain('id="triage"');
  expect(page).toContain('/api/inbox');
  expect(file('polls.js')).toContain("Data.get('inbox')"); // the data seam's GET of /api/inbox
});

// The banner and the inbox answered the same question from different data. Leaving the banner's
// code behind while removing its element is how a page throws on every refresh.
test('the old waiting-on-you banner is gone, element and code together', () => {
  expect(whole).not.toContain('id="alert"');
  expect(whole).not.toContain("getElementById('alert')");
});

// A session the board has never seen has no phase. The strip must show that, not invent one.
test('a strip is only filled when the board reported a phase', () => {
  expect(file('cleanup.js')).toMatch(/'<span class="phases' \+\s*\(known \? '' : ' unknown'\)/);
  expect(file('page.css')).toContain('.phases.unknown .pc');
  expect(file('cleanup.js')).toContain('No phase yet');
});

test('a row says where its link goes', () => {
  expect(file('board.js')).toContain('claude://code/continue?session=');
  expect(file('board.js')).toContain('opens this session in the Claude app');
});

// The operator's sorting is the one thing on this page they cannot get back from the endpoint.
test('the sorting is stored, and every sorting can be undone', () => {
  const state = file('state.js');
  expect(state).toContain("'flowwatch-triage-sorting'");
  // the old key is still read (the earlier name is joined here, so this file does not repeat it)
  const old = ['mission', 'control'].join('-');
  expect(state).toContain(`'flowwatch-triage-sorting': '${old}-triage-sorting'`);
  expect(state).toContain('Triage.applySorting');
  expect(file('toolbar.js')).toContain('data-undo');
});

// A hidden category holds sessions off the screen for good, so the page must go on counting them.
test('hiding a category is stored, and the header still counts what it holds back', () => {
  expect(file('state.js')).toContain("'flowwatch-hidden-categories'");
  // the old key is still read, so a browser keeps the categories it hid under the earlier name
  const old = ['mission', 'control'].join('-');
  expect(file('state.js')).toContain(`'flowwatch-hidden-categories': '${old}-hidden-categories'`);
  expect(file('sorting.js')).toContain('Triage.dropUnofferedPicks');
  expect(file('toolbar.js')).toContain('in hidden categories');
  expect(file('toolbar.js')).toMatch(/' of ' \+\s*rows\.length \+\s*' sessions shown'/);
});
