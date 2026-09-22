const { quoteOf } = require('../../../server/sessions/quote');

test('the quote is the last paragraph, plain and asking', () => {
  const q = quoteOf('First paragraph, long and **bold**.\n\nDecision for you: merge 841 or wait?');
  expect(q.text).toBe('Decision for you: merge 841 or wait?');
  expect(q.asks).toBe(true);
  expect(q.asks_from).toBe('question mark');
});

test('a closing statement does not read as a question', () => {
  const q = quoteOf('Done. The gate passed and the PR is open.');
  expect(q.asks).toBe(false);
  expect(q.asks_from).toBeNull();
});

// The wordless question is the case the phrase list exists for: without it these rows land in
// "Finished: archive it", the one group an operator has no reason to open.
test.each([
  'The rest is your call.',
  'Want me to run it against main first.',
  'Let me know and I will start.',
  'Two options, you decide which.',
  'Over to you.',
])('a handover without a question mark still asks: %s', (line) => {
  const q = quoteOf(line);
  expect(q.asks).toBe(true);
  expect(q.asks_from).toBe('phrasing');
});

test('a long paragraph is cut with an ellipsis', () => {
  const q = quoteOf('x'.repeat(400), { maxChars: 40 });
  expect(q.text).toHaveLength(40);
  expect(q.text.endsWith('…')).toBe(true);
});

test('an empty message has an empty quote', () => {
  expect(quoteOf('')).toEqual({ text: '', asks: false, asks_from: null });
});
