// renderValue draws the value feed's figures as the Mission page's headline. render.js is a plain browser
// script, so it runs in a vm with a stub element. What is pinned is what the reader sees: each sentence, its
// bold parts, its tone, nothing a feed wrote interpreted as markup, and an honest line for every state.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'web', 'lib', 'render.js'), 'utf8');

function render(value, panel) {
  const verdict = { innerHTML: '' };
  const sandbox = { document: { getElementById: (id) => (id === 'verdict' ? verdict : null) } };
  vm.createContext(sandbox);
  vm.runInContext(SRC + '\n;this.__rv = renderValue;', sandbox);
  sandbox.__rv(value, panel);
  return verdict.innerHTML;
}

const DATA = { state: 'data' };

test("each figure is one chip, with its bold parts bold and its tone as the chip's tone", () => {
  const html = render(
    {
      format: 1,
      figures: [
        { text: '**$4.20** realized over **12** round-trips', tone: 'good' },
        { text: 'no release yet' },
        { text: '**12 days** since a release', tone: 'warn' },
        { text: 'costs up', tone: 'neutral' },
      ],
    },
    DATA
  );
  expect(html).toBe(
    '<span class="flag good"><b>$4.20</b> realized over <b>12</b> round-trips</span>' +
      '<span class="flag">no release yet</span>' +
      '<span class="flag warn"><b>12 days</b> since a release</span>' +
      '<span class="flag">costs up</span>'
  );
});

test("a feed's text is never markup: it is escaped before the bold marks are read", () => {
  const html = render({ format: 1, figures: [{ text: '<img src=x onerror=alert(1)> **<b>x</b>**' }] }, DATA);
  expect(html).not.toMatch(/<img|<b>x/);
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; <b>&lt;b&gt;x&lt;/b&gt;</b>');
});

test('not set up, off and error each say so; off shows nothing', () => {
  expect(render(null, { state: 'not-set-up' })).toMatch(/value figures are not set up in this repo.*step 4/);
  expect(render(null, { state: 'off' })).toBe('');
  expect(render(null, { state: 'error', reason: 'value: its command exited with code 3' })).toBe(
    '<span class="flag warn">value figures could not be read: value: its command exited with code 3</span>'
  );
});
