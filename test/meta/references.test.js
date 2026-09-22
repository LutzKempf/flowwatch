// Nothing in the repo points at what a public reader cannot open: the private repo Flowwatch grew in,
// its pull requests, reviews and design documents, or the dashboard's earlier name. A comment states
// its reason in its own words instead of citing where the reason was first written down. The patterns
// are written so this file does not match itself.
const { repoFiles, repoLines, findings } = require('./repoFiles');

const PATTERNS = {
  'the private repo': /copy[-_ ]?trader/i,
  // Not an HTML entity (&#8212;) and not a CSS colour (color:#141417, gradient(…,#161619).
  'a pull request number': /(?<![&\w])(?<![:,]\s?)#\d{3,}\b/,
  'a review-pass citation': /review[ ]pass/i,
  'a bug hunt': /bug-?hunt/i,
  'the folder it grew in': /dev[-]pipeline/i,
  "the dashboard's earlier name": /mission[- ]control/i,
  'a dated design document': /design \d{4}-\d{2}-\d{2}/i,
  'a design document section': /§\s?\d/,
  'a design decision id': /\bD\d{1,3}\b/,
};

// The only lines allowed to match, by content. The earlier name is joined at run time, so this list
// is not itself a finding.
const OLD = ['mission', 'control'].join('-');
const ALLOWED = [
  // A browser that used the dashboard under its earlier name keeps its sorting and hidden categories.
  `'flowwatch-triage-sorting': '${OLD}-triage-sorting',`,
  `'flowwatch-hidden-categories': '${OLD}-hidden-categories',`,
  // An address saved under a panel's old name still opens that panel.
  "const RENAMED = { lifecycle: 'stages' };",
];
// The demo's snapshot is not Flowwatch's own text: it is another project's real sessions, whose names and titles
// may well mention the dashboard's history. Its owner read every line before signing it, and a change would void
// the signature, so it is left out here.
const SNAPSHOT = 'demo/data/';

test('no file refers to the private history Flowwatch grew in', () => {
  const lines = repoLines((file) => !file.startsWith(SNAPSHOT)).filter(({ text }) => !ALLOWED.includes(text.trim()));
  expect(findings(lines, PATTERNS)).toEqual([]);
});

test('no path refers to it either', () => {
  const paths = repoFiles().map((file) => ({ file, line: 0, text: file }));
  expect(findings(paths, PATTERNS)).toEqual([]);
});

test('the patterns catch what they are for, and leave colours and entities alone', () => {
  const hits = (text) => findings([{ file: 'x', line: 1, text }], PATTERNS).length;
  const j = (...parts) => parts.join('');
  for (const bad of [
    j('copy', '-trader'),
    j('Copy', 'Trader'),
    j('merged in (', '#', '874)'),
    j('PR ', '#', '812'),
    j('Review ', 'pass 2'),
    j('bug', 'hunt'),
    j('the dev', '-pipeline/ folder'),
    j('Mission', ' control'),
    j('design ', '2026-09-21'),
    j('(design ', '§', '10)'),
    j('// ', 'D', '11: flagged'),
  ]) {
    expect([bad, hits(bad)]).toEqual([bad, 1]);
  }
  for (const fine of ['--panel:#141417;', 'linear-gradient(180deg,#161619,#0e0e10)', '&#8212;', 'mode: D-7']) {
    expect([fine, hits(fine)]).toEqual([fine, 0]);
  }
});
