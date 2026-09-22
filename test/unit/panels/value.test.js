// The value feed's format: the figures a repo wants at the top of its Mission page, each one a short sentence
// the repo words itself (only it knows whether a missing figure means "none yet" or "not recorded").
const { checkValue } = require('../../../server/panels/value');

const figure = (text, tone) => (tone === undefined ? { text } : { text, tone });

test('a list of sentences, each with an optional tone, passes', () => {
  expect(
    checkValue({
      format: 1,
      figures: [
        figure('**3 of 9** workstreams ship'),
        figure('**$4.20** earned', 'good'),
        figure('no release yet', 'neutral'),
        figure('**12 days** since a release', 'warn'),
        figure('costs up', 'bad'),
      ],
    })
  ).toEqual([]);
});

test('figures that are missing, not a list, or empty are named', () => {
  expect(checkValue({ format: 1 })).toEqual(['"figures" must be a list']);
  expect(checkValue({ format: 1, figures: 'x' })).toEqual(['"figures" must be a list']);
  expect(checkValue({ format: 1, figures: [] })).toEqual(['"figures" is empty']);
});

test('more than eight figures is too many for the headline', () => {
  const nine = Array.from({ length: 9 }, (_, i) => figure('figure ' + i));
  expect(checkValue({ format: 1, figures: nine })).toEqual(['"figures" has 9 entries; at most 8']);
});

test('each figure needs text of at most 200 characters, and a known tone', () => {
  expect(
    checkValue({ format: 1, figures: [{}, figure(''), figure('x'.repeat(201)), figure('ok', 'great'), null] })
  ).toEqual([
    'figures[0].text must be a sentence',
    'figures[1].text must be a sentence',
    'figures[2].text has 201 characters; at most 200',
    'figures[3].tone must be one of good, bad, warn, neutral',
    'figures[4].text must be a sentence',
  ]);
});
