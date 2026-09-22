// Two phase signals that are easy to discard, so a phase reads N=0 although the
// work happened.
//
//  * Brainstorm — the Skill hook records a PLUGIN-NAMESPACED name
//    ('superpowers:brainstorming'); compared with === against the bare
//    'brainstorming', every namespaced invocation would map to null.
//  * Execute — backfilled commits cannot resolve touchesCode (no git context for a
//    historical commit), so the field is absent. `ev.touchesCode ? … : null` would
//    treat absent the same as an explicit false and drop the signal. Only an
//    explicit false ("this commit is docs-only") suppresses Execute.
const { phaseForEvent, detectPhase } = require('../../../server/sessions/phaseDetector');
const { PHASE } = require('../../../server/sessions/phases');

describe('plugin-namespaced skill names', () => {
  test('superpowers:brainstorming maps to Brainstorm', () => {
    expect(phaseForEvent({ type: 'skill', name: 'superpowers:brainstorming' })).toBe(PHASE.BRAINSTORM);
  });

  test('a namespaced cleanup still maps to Cleanup', () => {
    expect(phaseForEvent({ type: 'skill', name: 'superpowers:cleanup' })).toBe(PHASE.CLEANUP);
  });

  test('the bare names keep working', () => {
    expect(phaseForEvent({ type: 'skill', name: 'brainstorming' })).toBe(PHASE.BRAINSTORM);
    expect(phaseForEvent({ type: 'skill', name: 'cleanup' })).toBe(PHASE.CLEANUP);
  });

  test('an unrelated skill is still not a phase signal', () => {
    expect(phaseForEvent({ type: 'skill', name: 'superpowers:test-driven-development' })).toBeNull();
  });
});

describe('commit events whose touchesCode is unknown', () => {
  test('an absent touchesCode counts as Execute', () => {
    expect(phaseForEvent({ type: 'commit' })).toBe(PHASE.EXECUTE);
  });

  test('a null touchesCode counts as Execute', () => {
    expect(phaseForEvent({ type: 'commit', touchesCode: null })).toBe(PHASE.EXECUTE);
  });

  test('an explicit false still suppresses Execute', () => {
    expect(phaseForEvent({ type: 'commit', touchesCode: false })).toBeNull();
  });

  test('true still maps to Execute', () => {
    expect(phaseForEvent({ type: 'commit', touchesCode: true })).toBe(PHASE.EXECUTE);
  });
});

test('a backfilled session that brainstormed and committed reaches Execute', () => {
  // exactly the shape the transcript backfill produces: namespaced skill name,
  // and a commit with no touchesCode resolution available.
  const events = [{ type: 'user_prompt' }, { type: 'skill', name: 'superpowers:brainstorming' }, { type: 'commit' }];
  expect(detectPhase(events)).toBe(PHASE.EXECUTE);
});
