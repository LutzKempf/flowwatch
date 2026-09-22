// A number that is WRONG rather than missing is printed with the same confidence as a correct
// one, so the headline's "last 7 days" must span exactly seven calendar dates.
const { velocityFromLog } = require('../../../server/repo/gitVelocity');

// ── an inclusive window would span eight calendar dates ───────────────────────
describe('the trailing window spans exactly seven dates', () => {
  test('D-6 is inside the window and D-7 is outside', () => {
    expect(velocityFromLog(['2026-09-02\tfeat: x (#80)'], '2026-09-08').trailing7d).toBe(1);
    expect(velocityFromLog(['2026-09-01\tfeat: x (#81)'], '2026-09-08').trailing7d).toBe(0);
  });

  test('a commit dated after the anchor is not counted', () => {
    // git --date=short is the AUTHOR's local date; clock skew or a rebase can put it
    // ahead of the anchor, and counting it would inflate the headline velocity.
    expect(velocityFromLog(['2026-09-09\tfeat: x (#83)'], '2026-09-08').trailing7d).toBe(0);
  });
});
