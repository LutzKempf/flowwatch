// A repo's MISSION.md is where Flowwatch learns what the repo is for. What
// the reader cannot read it reports by name: a lost milestone would orphan every session tagged with it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseMission, findMissionFile } = require('../../../server/repo/missionFile');

const FULL = [
  '# Self-serve checkout that customers finish',
  '',
  'Let a customer go from cart to paid order',
  'without calling support.',
  '',
  'A second paragraph that is not the statement.',
  '',
  '## Focus',
  'Guest checkout for first-time buyers.',
  '',
  '## Milestones',
  '- `guest-checkout-live` Guest checkout in production — specs: checkout-flow; workstreams: guest-checkout, address-form',
  '- `saved-cards-live` Saved cards (returning customers) = one-click orders — specs: payment-methods, checkout-flow; workstreams: saved-cards',
  '- `status-page` Status page (hosting) — specs: uptime-monitor',
  '- `bare` A milestone with nothing mapped',
  '',
  '## Categories',
  'Checkout, Payments,',
  '- Retro',
  '* Architecture',
].join('\n');

test('reads the title, the first paragraph as the statement, the focus, milestones and categories', () => {
  const m = parseMission(FULL);
  expect(m.title).toBe('Self-serve checkout that customers finish');
  expect(m.statement).toBe('Let a customer go from cart to paid order without calling support.');
  expect(m.focus).toBe('Guest checkout for first-time buyers.');
  expect(m.milestones).toEqual([
    {
      id: 'guest-checkout-live',
      title: 'Guest checkout in production',
      specs: ['checkout-flow'],
      workstreams: ['guest-checkout', 'address-form'],
    },
    {
      id: 'saved-cards-live',
      title: 'Saved cards (returning customers) = one-click orders',
      specs: ['payment-methods', 'checkout-flow'],
      workstreams: ['saved-cards'],
    },
    { id: 'status-page', title: 'Status page (hosting)', specs: ['uptime-monitor'], workstreams: [] },
    { id: 'bare', title: 'A milestone with nothing mapped', specs: [], workstreams: [] },
  ]);
  expect(m.categories).toEqual(['Checkout', 'Payments', 'Retro', 'Architecture']);
  expect(m.problems).toEqual([]);
});

test('what cannot be read is reported by name, never dropped silently or guessed', () => {
  const m = parseMission(
    '# \n\n## Milestones\n- Guest-checkout go-live — specs: checkout-flow\n- `ok` Fine\n- `dup` One\n- `dup` Two\n'
  );
  expect(m.title).toBeNull();
  expect(m.statement).toBeNull();
  expect(m.milestones.map((x) => x.id)).toEqual(['ok', 'dup']);
  expect(m.problems).toEqual([
    'no mission title: the file needs a "# " heading with the mission on it',
    'no mission statement: the first paragraph under the title says what the repo is trying to achieve',
    'milestone line has no `id` and was left out: "Guest-checkout go-live — specs: checkout-flow"',
    'milestone id `dup` is used twice; the second ("Two") was left out',
  ]);
});

// Found only after an em dash, the mapping would silently lose its specs and workstreams whenever a hyphen
// was typed in its place. The mapping is found by its keywords; one it cannot read is named.
test('a milestone mapping is found by its keywords whatever dash precedes it, and an unreadable one is named', () => {
  const m = parseMission(
    [
      '# T',
      '',
      'S.',
      '',
      '## Milestones',
      '- `a` Guest-checkout go-live - specs: checkout-flow; workstreams: guest-checkout',
      '- `b` Saved-cards readiness -- specs: payment-methods',
      '- `c` Address form (guest-checkout) = fewer typos — workstreams: address-form',
      '- `d` Order emails — spec: order-emails',
      '- `e` Gift wrap — teams: gift-wrap',
    ].join('\n')
  );
  expect(m.milestones.map((x) => [x.id, x.title, x.specs, x.workstreams])).toEqual([
    ['a', 'Guest-checkout go-live', ['checkout-flow'], ['guest-checkout']],
    ['b', 'Saved-cards readiness', ['payment-methods'], []],
    ['c', 'Address form (guest-checkout) = fewer typos', [], ['address-form']],
    ['d', 'Order emails — spec: order-emails', [], []],
    ['e', 'Gift wrap — teams: gift-wrap', [], []],
  ]);
  expect(m.problems).toEqual([
    'milestone `d` names something after its title that is not "specs:" or "workstreams:": "spec: order-emails"',
    'milestone `e` names something after its title that is not "specs:" or "workstreams:": "teams: gift-wrap"',
  ]);
});

// The mapping starts at a spaced dash followed by "word:". A title with a spaced
// dash and no colon after it is left alone; one with "word:" after the dash is reported, and stays whole
// in the title — a visible false positive, chosen over missing a mistyped "spec:".
test('a spaced dash inside a title is left alone unless "word:" follows it', () => {
  const m = parseMission(
    '# T\n\nS.\n\n## Milestones\n- `a` Sub-project - Relaunch the site\n- `b` Rollout - Phase: two\n'
  );
  expect(m.milestones.map((x) => [x.id, x.title, x.specs, x.workstreams])).toEqual([
    ['a', 'Sub-project - Relaunch the site', [], []],
    ['b', 'Rollout - Phase: two', [], []],
  ]);
  expect(m.problems).toEqual([
    'milestone `b` names something after its title that is not "specs:" or "workstreams:": "Phase: two"',
  ]);
});

// A note under Categories ("The lanes of the task-chip table.") must not read as one more category. A line
// ending in "." or ":" is prose there, not a category.
test('a sentence under Categories is a note, not a category', () => {
  const m = parseMission(
    '# T\n\nS.\n\n## Categories\nThe lanes of the task-chip table.\nThese are:\n\nRetro, Architecture\n- Reporting\n'
  );
  expect(m.categories).toEqual(['Retro', 'Architecture', 'Reporting']);
});

// A category may own openspec capabilities: the lane cards file a spec under its owner, and the Mission page
// counts a change under the owner of what it edits. The mapping starts at a spaced dash of any kind, as a
// milestone's does; a plain name owns nothing.
test('a category line may name the specs it owns, exact names and name-* prefixes; a plain list owns none', () => {
  const m = parseMission(
    [
      '# T',
      '',
      'S.',
      '',
      '## Categories',
      'The lanes, and the specs each one owns.',
      '- Checkout — specs: checkout-flow, cart-*',
      '* Payments -- specs: payment-*',
      'Retro, Architecture',
      '- Reporting – specs: cart-analytics',
      '- Notifications - specs: order-emails',
    ].join('\n')
  );
  expect(m.categories).toEqual(['Checkout', 'Payments', 'Retro', 'Architecture', 'Reporting', 'Notifications']);
  expect(m.categorySpecs).toEqual({
    Checkout: ['checkout-flow', 'cart-*'],
    Payments: ['payment-*'],
    Retro: [],
    Architecture: [],
    Reporting: ['cart-analytics'],
    Notifications: ['order-emails'],
  });
  expect(m.problems).toEqual([]);
});

test('what a category line cannot say is named, never guessed', () => {
  const m = parseMission(
    [
      '# T',
      '',
      'S.',
      '',
      '## Categories',
      '- Checkout — spec: checkout-flow',
      '- Billing, Search — specs: invoices',
      '- Payments — specs: payment-*, gift-cards',
      '- Rewards — specs: gift-cards, payment-*, points',
      '- Checkout — specs: cart-*',
    ].join('\n')
  );
  // A category whose mapping cannot be read keeps its name and owns nothing; a spec two categories claim
  // stays with the first; a line naming two categories before its specs, or a category listed twice, is left out.
  expect(m.categories).toEqual(['Checkout', 'Payments', 'Rewards']);
  expect(m.categorySpecs).toEqual({ Checkout: [], Payments: ['payment-*', 'gift-cards'], Rewards: ['points'] });
  expect(m.problems).toEqual([
    'category `Checkout` names something after it that is not "specs:": "spec: checkout-flow"',
    'a category line names more than one category before its specs and was left out: "Billing, Search — specs: invoices"',
    'spec `gift-cards` is owned by both `Payments` and `Rewards`; `Payments` keeps it',
    'spec `payment-*` is owned by both `Payments` and `Rewards`; `Payments` keeps it',
    'category `Checkout` is listed twice; the second was left out',
  ]);
});

test('sections the file does not have are absent, not errors: a new repo may start with the mission alone', () => {
  const m = parseMission('# Ship the thing\n\nOne sentence.\n');
  expect(m).toMatchObject({
    title: 'Ship the thing',
    statement: 'One sentence.',
    focus: null,
    milestones: [],
    categories: [],
    categorySpecs: {},
    problems: [],
  });
});

describe('finding the file', () => {
  const repo = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mission-'));
  const put = (dir, rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };

  test('the repo root first, then docs/', () => {
    const r = repo();
    expect(findMissionFile(r)).toBeNull();
    put(r, 'docs/MISSION.md', '# From docs');
    expect(findMissionFile(r)).toEqual({ path: path.join(r, 'docs', 'MISSION.md'), text: '# From docs' });
    put(r, 'MISSION.md', '# From the root');
    expect(findMissionFile(r).path).toBe(path.join(r, 'MISSION.md'));
  });
});
