// The honesty ratchet.
//
// Status text typed into a dashboard's markup — a dateline, a headline figure, an ETA —
// goes stale with nothing to update it, and keeps reading as current. Every figure on
// these pages comes from an API field; a date or a status sentence in the markup means
// someone has started hand-maintaining state again, and this test is what tells them.
const { ownFiles } = require('./pageFiles');

// Each page's own markup, styles and scripts.
const FILES = ['mission.html', 'pipeline.html'].flatMap(ownFiles);

// Hand-typed status phrases these pages must not carry. Re-adding any of them is the regression.
const BANNED = [
  '50+ trader PRs shipped',
  'NEXT STEP',
  'NO lane has a validated live edge yet',
  'Pace → ETA',
  'DRAFT A',
  'Draft A',
  'Lane × lifecycle stage',
];

describe.each(FILES)('%s carries no hand-maintained status text', (_name, text) => {
  test('contains no ISO date literal', () => {
    // A date in the markup of a status page is either a stamp that will go stale,
    // or data — and data arrives from the API, never from the source file.
    const found = text.match(/\b20\d{2}-\d{2}-\d{2}\b/g);
    expect(found).toBeNull();
  });

  test.each(BANNED)('does not contain %p', (phrase) => {
    expect(text).not.toContain(phrase);
  });
});

// The milestones are the other place hand-typed state could hide: they come from the repo's MISSION.md,
// and its reader has no eta or status field to type state into.
