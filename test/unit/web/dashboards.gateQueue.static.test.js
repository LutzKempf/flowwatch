const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { WEB, ownFiles, pageFile } = require('./pageFiles');

const page = pageFile('pipeline.html', 'pipeline.html');
const gates = pageFile('pipeline.html', 'pages/pipeline/gates.js');

test('the gate queue has a place beside the inbox and reads the collector', () => {
  expect(page).toContain('id="gates"');
  expect(gates).toContain("Data.get('gates')"); // the data seam's GET of /api/gates (test/unit/web/data.test.js)
});

// The scheduler has no reorder, and giving it one would change the repo's shared gate infrastructure.
// Drag handles, arrows or a "Back to fair order" button must not arrive here by accident.
test.each(ownFiles('pipeline.html'))('%s is read-only: nothing on it can reorder the queue', (_name, text) => {
  expect(text).not.toMatch(/draggable/);
  expect(text).not.toContain('data-gq-move');
  expect(text).not.toContain('Back to fair order');
  expect(text).not.toMatch(/mission-gate-order/);
});

test('old gate data says how old it is', () => {
  expect(gates).toContain('GATE_STALE_MS = 2 * 60000');
  expect(gates).toContain('not updated for');
});

// Not set up, off and error say so on the gate panel as on every other panel, with the same note. The branch is
// found in the panel's module, and the note it draws is run from render.js.
test('a gates feed that is not set up, off or broken says so on the panel, never an empty queue', () => {
  expect(gates).toContain("if (Q.state !== 'data') {");
  expect(gates).toContain("panelNote(Q, GATES_WHAT, feedAgent('gates'))");
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(WEB, 'lib', 'render.js'), 'utf8') +
      "\n;this.__note = (q) => panelNote(q, GATES_WHAT, feedAgent('gates'));",
    sandbox
  );
  expect(sandbox.__note({ state: 'not-set-up' })).toMatch(/Not set up in this repo.*gates feed/);
  expect(sandbox.__note({ state: 'not-set-up' })).toContain('&quot;gates&quot;: { &quot;command&quot;');
  expect(sandbox.__note({ state: 'off' })).toMatch(/does not use this panel/);
  expect(sandbox.__note({ state: 'error', reason: 'gates: its command exited with code 4: <locked>' })).toContain(
    'Could not be read: gates: its command exited with code 4: &lt;locked&gt;.'
  );
});
