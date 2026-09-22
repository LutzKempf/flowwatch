// The ideas feed's format: every idea the repo has evaluated, in the repo's own sections, each with its verdict
// and which way that verdict went. Flowwatch counts the verdicts and finds each section's latest date itself.
const { checkIdeas, ideasPayload, BUCKETS } = require('../../../server/panels/ideas');

const idea = (o = {}) => ({ n: 1, name: 'One-page checkout', verdict: 'Promising', bucket: 'open', ...o });
const feed = (o = {}) => ({ format: 1, sections: [{ title: 'Checkout flow', ideas: [idea()] }], ...o });

test('the four buckets are exactly the ones a verdict may fall in', () => {
  expect(BUCKETS).toEqual(['closed', 'inconclusive', 'open', 'unclassified']);
});

test('a feed with a source, sections, full and minimal ideas, and warnings passes', () => {
  expect(
    checkIdeas(
      feed({
        source: 'docs/ideas.md',
        warnings: ['row 9 was not read'],
        sections: [
          {
            title: 'Checkout flow',
            ideas: [
              idea({ evidence: '1,200 carts', date: '2026-08-20', docs: 'docs/a.md' }),
              { name: 'Wallet buttons', verdict: 'Not sorted yet', bucket: 'unclassified' },
            ],
          },
          { title: 'Nothing tried yet', ideas: [] },
        ],
      })
    )
  ).toEqual([]);
  expect(checkIdeas(feed({ sections: [] }))).toEqual([]); // nothing evaluated yet is a state, not an error
});

test('sections that are missing or not a list are named', () => {
  expect(checkIdeas({ format: 1 })).toEqual(['"sections" must be a list']);
  expect(checkIdeas(feed({ sections: {} }))).toEqual(['"sections" must be a list']);
});

test('every problem in a section and its ideas is named', () => {
  expect(
    checkIdeas(
      feed({
        sections: [
          null,
          { ideas: [] },
          { title: 'Payments', ideas: 'x' },
          {
            title: 'Checkout flow',
            ideas: [
              null,
              { n: 2, bucket: 'open' },
              idea({ bucket: 'maybe' }),
              idea({ n: 1.5, date: '2026-8-1', evidence: 3, docs: ['a.md'] }),
              idea({ n: -1, date: '2026-02-30' }),
            ],
          },
        ],
      })
    )
  ).toEqual([
    'sections[0] must be an object',
    'sections[1].title must be a name',
    'sections[2].ideas must be a list',
    'sections[3].ideas[0] must be an object',
    'sections[3].ideas[1].name must be a name',
    'sections[3].ideas[1].verdict must be a sentence',
    'sections[3].ideas[2].bucket must be one of closed, inconclusive, open, unclassified',
    'sections[3].ideas[3].n must be a whole number',
    'sections[3].ideas[3].date must be a day written YYYY-MM-DD',
    'sections[3].ideas[3].evidence must be text',
    'sections[3].ideas[3].docs must be text',
    'sections[3].ideas[4].n must be a whole number',
    'sections[3].ideas[4].date must be a day written YYYY-MM-DD',
  ]);
});

test('source and warnings, when given, are text', () => {
  expect(checkIdeas(feed({ source: 7 }))).toEqual(['"source" must be text']);
  expect(checkIdeas(feed({ warnings: 'x' }))).toEqual(['"warnings" must be a list of sentences']);
});

describe('ideasPayload — what the page gets', () => {
  const out = ideasPayload(
    feed({
      source: 'docs/ideas.md',
      sections: [
        {
          title: 'Checkout flow',
          counts: { closed: 99 },
          latest: '2030-01-01',
          ideas: [
            idea({ n: 1, bucket: 'open', date: '2026-08-20' }),
            idea({ n: 2, bucket: 'closed', date: '2026-07-30' }),
            idea({ n: 3, bucket: 'closed', date: '2026-09-02' }),
            idea({ n: 4, bucket: 'inconclusive' }),
          ],
        },
        { title: 'Payments', ideas: [idea({ n: 5, bucket: 'unclassified' })] },
      ],
    })
  );

  test('each section counts its ideas by bucket itself, whatever counts the feed wrote', () => {
    expect(out.sections[0].counts).toEqual({ closed: 2, inconclusive: 1, open: 1, unclassified: 0 });
    expect(out.sections[1].counts).toEqual({ closed: 0, inconclusive: 0, open: 0, unclassified: 1 });
  });

  test("each section's latest is its newest idea date, or null when none is dated", () => {
    expect(out.sections[0].latest).toBe('2026-09-02');
    expect(out.sections[1].latest).toBeNull();
  });

  test('the ideas, the source and the warnings pass through; the format number does not', () => {
    expect(out.sections[0].ideas.map((i) => i.n)).toEqual([1, 2, 3, 4]);
    expect(out.source).toBe('docs/ideas.md');
    expect(out.warnings).toEqual([]);
    expect(out.format).toBeUndefined();
    expect(ideasPayload({ format: 1, sections: [] })).toEqual({ source: null, sections: [], warnings: [] });
    expect(ideasPayload(null)).toBeNull();
  });
});
