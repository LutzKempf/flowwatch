// Stale is not a state: the page keeps two orthogonal facts apart. Collapsed into one field,
//   state: s.stale ? 'stale' : (STATE_MAP[s.state] || 'work')
// the ternary would take the stale branch for nearly every session (most are idle longer than
// the five-minute stale threshold), and the counter — which increments only on
// state === 'waityou' — could never be anything but zero, whatever the server sent.
//
// The server half is pinned in pipelineApi.waitingOnYou.test.js; the page can still read zero
// on its own, so it is pinned here too.
const { ownFiles, pageFile } = require('./pageFiles');

const P = 'pipeline.html';
const HTML = pageFile(P, P);
const CSS = pageFile(P, 'pages/pipeline/page.css');
const LANES = pageFile(P, 'pages/pipeline/polls.js'); // where the page builds its lanes from the payload
const BOARD = pageFile(P, 'pages/pipeline/board.js');
const WORDS = pageFile(P, 'pages/pipeline/format.js');
// Everything the page is made of, for what must appear nowhere on it.
const PAGE = ownFiles(P)
  .map(([, text]) => text)
  .join('\n');

test('staleness never overwrites the lane state', () => {
  expect(PAGE).not.toMatch(/state:\s*s\.stale\s*\?/);
});

test('the lane carries stale as its own field', () => {
  expect(LANES).toMatch(/stale:\s*s\.stale/);
});

test('the current cell can be both a state and stale at once', () => {
  // ' cur ' + s.state + (s.stale ? ' stale' : '') — the two classes coexist on the cell.
  expect(BOARD).toMatch(/c \+= ' cur ' \+ s\.state \+ \(s\.stale \? ' stale' : ''\)/);
});

test('the stale cell rule dims rather than repaints', () => {
  // A background/border rule at equal specificity wins over .cell.cur.waityou by
  // source order, which is exactly how the waiting colour disappeared.
  expect(CSS).toMatch(/\.cell\.cur\.stale \{\s*opacity:/);
  expect(CSS).not.toMatch(/\.cell\.cur\.stale \{[^}]*background/);
});

// The waiting list is the board, and the board has to list every open conversation, so a cap would
// hide rows. The rule's own test is in test/unit/web/sessionsBoard.test.js.
test('the board lists every open session, uncapped', () => {
  expect(pageFile(P, 'pages/pipeline/rows.js')).toContain('Triage.boardItems');
  expect(PAGE).not.toContain('GROUP_MAX');
  expect(PAGE).not.toMatch(/more waiting/);
});

describe('abandoned is its own state, not the working colour', () => {
  test('the page knows the abandoned state', () => {
    expect(WORDS).toMatch(/abandoned:\s*'abandoned'/);
    expect(WORDS).toMatch(/abandoned:\s*'ended mid-turn'/);
  });

  test('abandoned has its own cell rule and does not borrow the amber one', () => {
    expect(CSS).toMatch(/\.cell\.cur\.abandoned \{/);
    // If it fell through to .cell.cur.work the board would keep claiming an agent is
    // mid-task on a recording that simply stopped — the case this state exists for.
    expect(CSS).toMatch(/\.cell\.cur\.work \{\s*background: rgba\(245, 181, 68,/);
  });

  test('the marker is driven by the state, not by staleness', () => {
    // Match the condition rather than the glyph. Keyed off s.stale, a stale WAITING lane would lose its
    // raised-hand marker.
    expect(BOARD).toMatch(/s\.state === 'abandoned' \?/);
    expect(PAGE).not.toMatch(/\(s\.stale \? '(\\u00b7|··)/);
  });

  test('the legend names it', () => {
    expect(HTML).toContain('ended mid-turn (never handed back)');
  });
});

test('the tile still counts every waiting session, capped list or not', () => {
  // The cap is presentational. If it ever gated the counter, the headline number
  // would silently stop at 6.
  expect(BOARD).toMatch(/if \(s\.state === 'waityou'\) waiting\+\+/);
});
