const { factBucket, GROUPS } = require('../../../web/lib/triage');

const item = (over = {}) => ({
  key: 'm1',
  session_id: 'local_1',
  title: 'Retro: something',
  state: 'waiting',
  pending_question: false,
  asks: false,
  api_error: false,
  pr: { status: 'none', numbers: [] },
  ...over,
});

// The groups say what a session needs, and a session needs one thing. The order below is the
// precedence: a broken session is broken even when it also has an open pull request.
test('a session that ended mid-turn or errored is stopped-or-broken', () => {
  expect(factBucket(item({ state: 'abandoned' }))).toBe('stuck');
  expect(factBucket(item({ api_error: true }))).toBe('stuck');
  // The app records its own failures separately from the API's, and both mean broken.
  expect(factBucket(item({ app_error: true }))).toBe('stuck');
  expect(factBucket(item({ state: 'abandoned', asks: true, pr: { status: 'open', numbers: [12] } }))).toBe('stuck');
});

test('a session that asked something needs an answer', () => {
  expect(factBucket(item({ pending_question: true }))).toBe('answer');
  expect(factBucket(item({ asks: true }))).toBe('answer');
  expect(factBucket(item({ asks: true, pr: { status: 'open', numbers: [12] } }))).toBe('answer');
});

test('a session with an open pull request is for review or merge', () => {
  expect(factBucket(item({ pr: { status: 'open', numbers: [12] } }))).toBe('merge');
  expect(factBucket(item({ pr: { status: 'merged', numbers: [12] } }))).toBe('done');
});

test('everything else is finished', () => {
  expect(factBucket(item())).toBe('done');
});

test('every group a session can land in is one of the four the page renders', () => {
  const ids = GROUPS.map((g) => g.id);
  const cases = [
    item(),
    item({ asks: true }),
    item({ state: 'abandoned' }),
    item({ pr: { status: 'open', numbers: [1] } }),
    item({ pending_question: true, api_error: true }),
  ];
  for (const c of cases) expect(ids).toContain(factBucket(c));
  expect(new Set(ids).size).toBe(ids.length);
});
