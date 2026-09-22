// renderIdeas draws the ideas feed on the Mission page's Ideas panel. render.js is a plain
// browser script, so it runs in a vm with a stub document (as renderValue's test does);
// what is pinned is what the operator reads: the counts, every idea, and that a section
// they opened stays open when the page redraws every 30 s.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'web', 'lib', 'render.js'), 'utf8');

function page() {
  const ideas = {
    innerHTML: '',
    // the stub reads back which <details> the last render left open
    querySelectorAll: () =>
      [...ideas.innerHTML.matchAll(/data-key="([^"]+)" open>/g)].map((m) => ({
        dataset: { key: m[1].replace(/&amp;/g, '&') },
      })),
  };
  const els = { ideas, 'ideas-sum': { innerHTML: '', textContent: '' } };
  const sandbox = { document: { getElementById: (id) => els[id] || null } };
  vm.createContext(sandbox);
  vm.runInContext(SRC + '\n;this.__ri = renderIdeas;', sandbox);
  return { render: sandbox.__ri, els };
}

const DATA = { state: 'data' };
const idea = (n, bucket, date) => ({
  n,
  name: 'idea ' + n,
  verdict: 'V' + n,
  bucket,
  evidence: 'E' + n,
  date,
  docs: 'd' + n + '.md',
});
const IDEAS = {
  source: 'docs/checkout-ideas.md',
  warnings: [],
  sections: [
    {
      title: 'Checkout flow',
      latest: '2026-09-05',
      counts: { closed: 2, inconclusive: 1, open: 0, unclassified: 0 },
      ideas: [
        idea(24, 'closed', '2026-07-14'),
        idea(28, 'inconclusive', '2026-07-24'),
        idea(59, 'closed', '2026-09-05'),
      ],
    },
    {
      title: 'Payments',
      latest: '2026-07-14',
      counts: { closed: 0, inconclusive: 0, open: 1, unclassified: 0 },
      ideas: [idea(42, 'open', '2026-07-14')],
    },
  ],
};

test('the summary counts every idea across sections, by verdict', () => {
  const { render, els } = page();
  render(IDEAS, DATA);
  const sum = els['ideas-sum'].innerHTML;
  expect(sum).toContain('4 ideas evaluated');
  expect(sum).toContain('2 ruled out');
  expect(sum).toContain('1 inconclusive');
  expect(sum).toContain('1 open or promising');
  expect(sum).toContain('— from <span class="mono">' + IDEAS.source + '</span>');
});

test('each section lists all of its ideas with verdict, numbers and source', () => {
  const { render, els } = page();
  render(IDEAS, DATA);
  const html = els.ideas.innerHTML;
  expect(html.match(/class="idea /g)).toHaveLength(4);
  expect(html).toContain('Checkout flow</b><span class="idn">3 ideas');
  for (const n of [24, 28, 59, 42]) {
    expect(html).toContain('#' + n);
    expect(html).toContain('V' + n);
    expect(html).toContain('E' + n);
    expect(html).toContain('d' + n + '.md');
  }
});

test('a section or idea the operator opened stays open across the redraw', () => {
  const { render, els } = page();
  render(IDEAS, DATA);
  expect(els.ideas.innerHTML).not.toContain(' open>');
  els.ideas.innerHTML = els.ideas.innerHTML
    .replace('data-key="s:Checkout flow">', 'data-key="s:Checkout flow" open>')
    .replace('data-key="i:59">', 'data-key="i:59" open>');
  render(IDEAS, DATA);
  expect(els.ideas.innerHTML).toContain('data-key="s:Checkout flow" open>');
  expect(els.ideas.innerHTML).toContain('data-key="i:59" open>');
  expect(els.ideas.innerHTML).not.toContain('data-key="s:Payments" open>');
});

test('an idea with only a name, a verdict and a bucket shows no gaps, and keeps its open state by its name', () => {
  const { render, els } = page();
  const bare = {
    title: 'Payments',
    latest: null,
    counts: { closed: 0, inconclusive: 0, open: 0, unclassified: 1 },
    ideas: [{ name: 'Wallet buttons', verdict: 'Not sorted yet', bucket: 'unclassified' }],
  };
  render({ source: null, warnings: [], sections: [bare] }, DATA);
  expect(els.ideas.innerHTML).not.toMatch(/undefined|null|#</);
  expect(els.ideas.innerHTML).toContain('data-key="i:Payments/Wallet buttons"');
  expect(els['ideas-sum'].innerHTML).toContain('<span class="ib unclassified">1 verdict not sorted</span>');
  expect(els['ideas-sum'].innerHTML).not.toMatch(/undefined|null|— from/); // no source given: none named
});

test('nothing a feed writes is markup: every text is escaped', () => {
  const { render, els } = page();
  const x = '<img src=x onerror=alert(1)>';
  render(
    {
      source: x,
      warnings: [x],
      sections: [
        {
          title: x,
          latest: null,
          counts: { closed: 1, inconclusive: 0, open: 0, unclassified: 0 },
          ideas: [{ n: 1, name: x, verdict: x, bucket: 'closed', evidence: x, docs: x }],
        },
      ],
    },
    DATA
  );
  expect(els.ideas.innerHTML + els['ideas-sum'].innerHTML).not.toContain('<img');
  expect(els.ideas.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
});

test('a feed that cannot be read says so in words instead of an empty panel', () => {
  const { render, els } = page();
  render(null, { state: 'error', reason: 'ideas: its command exited with code 2: no such file' });
  expect(els['ideas-sum'].innerHTML).toContain(
    'Could not be read: ideas: its command exited with code 2: no such file.'
  );
  expect(els.ideas.innerHTML).toBe('');
  render(null, { state: 'not-set-up' });
  expect(els['ideas-sum'].innerHTML).toMatch(/Not set up in this repo/);
  expect(els['ideas-sum'].innerHTML).toContain('&quot;ideas&quot;: { &quot;file&quot;');
});

test('rows the feed could not read are named on the page', () => {
  const { render, els } = page();
  render({ ...IDEAS, warnings: ['Payments #9: 11 cells, header has 9'] }, DATA);
  expect(els['ideas-sum'].innerHTML).toContain('Rows not read:</b> Payments #9: 11 cells, header has 9');
});
