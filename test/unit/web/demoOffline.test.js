// In the demo nobody can open the operator's Claude sessions: a link into the Claude app would be a dead link
// in front of every visitor. And the footers must not claim live data the demo does not have.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { WEB, ownFiles, pageFile } = require('./pageFiles');

const P = 'pipeline.html';
const page = pageFile(P, P);
// The Sessions page's markup, styles and modules, as one text.
const whole = ownFiles(P)
  .map(([, text]) => text)
  .join('\n');

test('every link into the Claude app on the Sessions page is made only when the page is live', () => {
  const links = whole.match(/claude:\/\/code\/continue/g) || [];
  expect(links.length).toBeGreaterThan(0);
  // each link sits in the true branch of a condition that starts with IN_APP
  const guarded = whole.match(/(?:=|return)\s+IN_APP && [^?]*\?\s*'<a href="claude:\/\/code\/continue/g) || [];
  expect(guarded.length).toBe(links.length);
  expect(pageFile(P, 'pages/pipeline/format.js')).toMatch(/const IN_APP = !Data\.demo;/);
});

test('the Cleanup hand-off gets no folder in the demo, so it offers only the list to copy', () => {
  expect(pageFile(P, 'pages/pipeline/cleanup.js')).toMatch(
    /Triage\.closeOutPrompt\(picks, \{ folder: IN_APP && L && L\.repo_root,/
  );
});

function renderSources(demo) {
  const el = { textContent: '' };
  const sandbox = { document: { getElementById: (id) => (id === 'mc-sources' ? el : null) }, Data: { demo } };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(WEB, 'lib', 'render.js'), 'utf8') + '\n;this.__rs = renderSources;',
    sandbox
  );
  sandbox.__rs({ mission: 'MISSION.md', specs: true, changes: true }, {});
  return el.textContent;
}

test('the Mission footer says live or snapshot, as the page is', () => {
  expect(renderSources(null)).toMatch(/ · live via \/api\/mission \(30 s poll\)$/);
  const demo = renderSources({ project: 'x', snapshotAt: Date.parse('2026-09-21T12:00:00Z') });
  expect(demo).toMatch(/ · a snapshot taken 2026-09-21$/);
  expect(demo).not.toMatch(/live|\/api\//);
});

test('the Sessions footer is replaced in the demo', () => {
  expect(page).toMatch(/<span id="footer-source">Live data · \/api\/pipeline · 2 s poll<\/span>/);
  expect(pageFile(P, 'pages/pipeline/main.js')).toMatch(
    /if \(Data\.demo\)\s*document\.getElementById\('footer-source'\)\.textContent =/
  );
});
