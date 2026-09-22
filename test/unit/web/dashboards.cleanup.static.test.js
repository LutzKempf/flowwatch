const { ENDPOINTS } = require('../../../web/lib/data.js');
const { pageFiles, ownFiles, pageFile } = require('./pageFiles');

// Closing reaches outside the browser only by opening a session. The page and the scripts it
// loads must carry no way to change anything themselves — a click would otherwise remove work the
// operator meant to review first, with no summary and no second answer.
const page = pageFile('pipeline.html', 'pipeline.html');
const scripts = [...page.matchAll(/<script src="\/(lib\/[^"]+)"/g)].map((m) => m[1]);
const sources = pageFiles('pipeline.html');
const cleanup = pageFile('pipeline.html', 'pages/pipeline/cleanup.js');

test('the page loads the triage rules, so the checks below cover the hand-off code', () => {
  expect(scripts).toContain('lib/triage.js');
});

test('the page loads the data seam, so the checks below cover the one fetch there is', () => {
  expect(scripts).toContain('lib/data.js');
});

test.each(sources)('%s reads with plain GETs of its own API and nothing else', (name, text) => {
  // Every read goes through the data seam by an endpoint's name, written out. The seam maps a name to the
  // collector's /api/<name> and to nothing else, or in the demo to the snapshot's data/<name>.json
  // (test/unit/web/data.test.js)...
  for (const [call, arg] of text.matchAll(/Data\.get\(([^)]*)\)/g)) {
    expect([call, /^'[a-z-]+'$/.test(arg) && ENDPOINTS.includes(arg.slice(1, -1))]).toEqual([call, true]);
  }
  // ...and the seam's own GET of that URL is the only fetch anywhere.
  const fetches = [...text.matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[0]);
  expect(fetches).toEqual(name === 'lib/data.js' ? ['fetch(urlOf(name, Boolean(demo)'] : []);
  expect(text).not.toMatch(/\bmethod\s*:/);
  expect(text).not.toMatch(/XMLHttpRequest|sendBeacon|new WebSocket|\.submit\(/);
  expect(text).not.toMatch(/<form\b/i);
});

test.each(sources)('%s opens the app only to continue a session or to start one', (_name, text) => {
  const allowed = ['claude://code/continue?session=', 'claude://code/new?q='];
  for (const [link] of text.matchAll(/claude:\/\/[^'"`\s)]*/g)) {
    expect([link, allowed.some((a) => link === a)]).toEqual([link, true]);
  }
});

test.each(ownFiles('pipeline.html'))(
  "%s starts a cleanup session only from the hand-off panel's link, never by a script",
  (_name, text) => {
    expect(text).not.toMatch(/location(\.href)?\s*=|window\.open\(|\.click\(\)/);
  }
);

// The hand-off runs the skill the repo names in flowwatch.json ("cleanup.skill"); no skill name is built in.
test.each(sources)('%s names no cleanup skill of its own', (_name, text) => {
  expect(text).not.toMatch(/close-out|close_out_skill/);
});

test('the Cleanup view takes what it says about the skill, and whether to link, from the lanes payload', () => {
  expect(cleanup).toContain('Triage.cleanupSkillNote(L && L.cleanup_skill)');
  // no folder in the demo: nobody there can open a session, so the hand-off offers only the list to copy
  expect(cleanup).toMatch(
    /Triage\.closeOutPrompt\(picks, \{ folder: IN_APP && L && L\.repo_root, skill: note\.skill \}\)/
  );
});
