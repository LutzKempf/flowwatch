// Without the Claude app's session records (Linux, or a folder that is not there), the Sessions board still runs
// on the session hooks, with no titles and no waiting states. It says so in one plain line, and where it looked,
// instead of the "cannot read" warning an unreadable folder gets.
const { recordsNote } = require('../../../web/lib/triage');
const { pageFile } = require('./pageFiles');

test('a records folder that was not found gets one plain line naming where it looked', () => {
  expect(
    recordsNote({
      records_folder: {
        found: false,
        looked: 'looked in /u/ann/Library/Application Support/Claude/claude-code-sessions',
      },
    })
  ).toBe(
    'Titles and waiting states come from the session hooks only: the Claude app’s session records were not found ' +
      '(looked in /u/ann/Library/Application Support/Claude/claude-code-sessions).'
  );
});

test('a found folder, or an inbox that has not loaded, says nothing', () => {
  expect(recordsNote({ records_folder: { found: true, looked: 'looked in /x' } })).toBeNull();
  expect(recordsNote(null)).toBeNull();
  expect(recordsNote({})).toBeNull();
});

test('the Sessions board shows the line, escaped, in place of the "cannot read" warning for the records', () => {
  const toolbar = pageFile('pipeline.html', 'pages/pipeline/toolbar.js'); // the inbox's line over the board
  expect(toolbar).toContain('const recordsLine = Triage.recordsNote(data);');
  expect(toolbar).toContain('escapeHtml(recordsLine)');
  expect(toolbar).toContain("filter((k) => data.sources[k] !== 'ok' && !(k === 'app_records' && recordsLine))");
});
