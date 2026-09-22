// Both dashboards take their sidebar from lib/nav.js and nowhere else, and each carries exactly the
// panel containers of its own group — a panel with no container would show an empty page.
const { NAV } = require('../../../web/lib/nav.js');
const { ownFiles, pageFile } = require('./pageFiles');

describe.each(NAV.map((g) => [g.file, g]))('%s', (file, group) => {
  const html = pageFile(file, file);
  const others = NAV.filter((g) => g !== group).flatMap((g) => g.panels);

  test('loads the shared nav script and stylesheet and has the sidebar mount', () => {
    expect(html).toContain('<script src="/lib/nav.js"></script>');
    expect(html).toContain('<link rel="stylesheet" href="/lib/nav.css">');
    expect(html).toContain('<nav id="nav"');
    // the page's script, a module the page loads last, draws the sidebar
    const entry = [...html.matchAll(/<script type="module" src="\/([^"]+)"><\/script>/g)].map((m) => m[1]);
    expect(entry).toHaveLength(1);
    expect(pageFile(file, entry[0])).toMatch(/Nav\.initNav\(\)/);
  });

  test.each(group.panels.map((p) => [p.id]))('has exactly one container for panel %s', (id) => {
    expect(html.split('data-panel="' + id + '"').length - 1).toBe(1);
  });

  test('has no container for the other group’s panels', () => {
    for (const p of others) expect(html).not.toContain('data-panel="' + p.id + '"');
  });

  test.each(ownFiles(file))('%s never hand-writes a sidebar link', (_name, text) => {
    expect(text).not.toMatch(/href="\/(pipeline|mission)\//);
  });
});

test('the narrow-window rail hides the labels below 820 px', () => {
  const css = pageFile('pipeline.html', 'lib/nav.css');
  const narrow = css.slice(css.indexOf('@media(max-width:820px){'));
  expect(narrow).toMatch(/^@media\(max-width:820px\)\{.*[,{]\.nav-lb[^{]*\{display:none\}/);
});
