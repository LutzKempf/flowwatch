// The two setup rules, run rather than read: a panel the repo will never use is told apart from one not
// set up yet, and the banner is raised by what needs doing, not by options.
const { panelState, bannerItems } = require('../../../server/setup/setupRules');

describe('a panel that reads a repo-specific source', () => {
  test('false in flowwatch.json: this repo does not use it, and it leaves the sidebar', () => {
    expect(panelState({ config: { stages: false }, key: 'stages' })).toEqual({ state: 'off' });
  });
  test('absent: not set up yet, with what it needs', () => {
    expect(panelState({ config: {}, key: 'stages' })).toEqual({ state: 'not-set-up' });
    expect(panelState({ config: null, key: 'stages' })).toEqual({ state: 'not-set-up' }); // no file at all
  });
  test('flowwatch.json that is not valid JSON: every panel it would wire is an error with the parse reason', () => {
    expect(panelState({ configError: 'Unexpected token } in JSON at position 41', key: 'ideas' })).toEqual({
      state: 'error',
      reason: 'flowwatch.json is not valid JSON: Unexpected token } in JSON at position 41',
    });
  });
  test('configured and present: data', () => {
    expect(panelState({ config: { ideas: { file: 'feeds/ideas.json' } }, key: 'ideas' })).toEqual({ state: 'data' });
  });
});

describe('the setup banner', () => {
  const item = (id, state, required) => ({ id, state, required });
  test('raised while a required item needs doing or the mission file has problems, and lists only what needs doing', () => {
    const items = [
      item('mission', 'ok', true),
      item('mission-problems', 'problem', true),
      item('hooks', 'ok', true),
      item('stages', 'not-set-up', false),
      item('ideas', 'off', false),
    ];
    expect(bannerItems(items).map((i) => i.id)).toEqual(['mission-problems', 'stages']);
  });
  test('not raised by optional panels alone: a repo may simply not have set them up yet', () => {
    expect(
      bannerItems([item('mission', 'ok', true), item('hooks', 'ok', true), item('stages', 'not-set-up', false)])
    ).toEqual([]);
  });
  test('required items come first', () => {
    const out = bannerItems([
      item('stages', 'not-set-up', false),
      item('hooks', 'missing', true),
      item('mission', 'missing', true),
    ]);
    expect(out.map((i) => i.id)).toEqual(['hooks', 'mission', 'stages']);
  });
});
