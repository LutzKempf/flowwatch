// Test fixture: a made-up repo's own category inference, named in its flowwatch.json
// ("sessions": { "categorize": "scripts/categorize.js" }). It files a session, spec or change by the words
// in what it is given; the first pattern that matches wins.
const WORDS = [[/cart|checkout|basket/, 'Checkout'], [/payment|card/, 'Payments'], [/report|analytics/, 'Reporting'],
  [/email/, 'Notifications']];

function inferCategory(...sources) {
  const text = sources.filter(Boolean).join(' ').toLowerCase();
  const hit = WORDS.find(([re]) => re.test(text));
  return hit ? hit[1] : null;
}

module.exports = { inferCategory };
