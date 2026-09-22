const { stateForEvents } = require('../../../server/sessionState');

test('a turn_stop as the last event means waiting on the operator', () => {
  expect(stateForEvents([{ type: 'bash' }, { type: 'turn_stop' }])).toBe('waiting');
});

test('any other last event means working', () => {
  expect(stateForEvents([{ type: 'turn_stop' }, { type: 'user_prompt' }])).toBe('working');
  expect(stateForEvents([{ type: 'bash' }])).toBe('working');
});

test('no events at all is working, never waiting', () => {
  expect(stateForEvents([])).toBe('working');
});
