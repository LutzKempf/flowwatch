// A row is decidable when it shows the session's own last words. These are the shapes a reply uses
// to hand the decision over; a question mark alone misses "your call" and over-matches a rhetorical
// aside, so both signals are used — and which one fired travels with the answer, because "this
// session is asking you something" is a guess and the page must be able to say so.
const ASKS =
  /\b(want me to|should (i|we)|which (of|one|do|should)|say (go|the word)|your call|decide|approve|shall i|do you want|let me know|over to you)\b/i;
const DEFAULT_MAX = 280;

/** @type {(s: string) => string} */
const plain = (s) =>
  String(s)
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The last paragraph of a session's final message, plain and capped, whether it asks the operator
 * for something, and which signal said so.
 * @param {string} finalText the whole final message
 * @param {{maxChars?: number}} [opts] cap for the quote
 * @returns {{text: string, asks: boolean, asks_from: 'question mark'|'phrasing'|null}}
 */
function quoteOf(finalText, { maxChars = DEFAULT_MAX } = {}) {
  const paragraphs = String(finalText || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const last = paragraphs[paragraphs.length - 1] || '';
  const text = plain(last);
  const from = last.includes('?') ? 'question mark' : ASKS.test(last) ? 'phrasing' : null;
  return {
    text: text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text,
    asks: from !== null,
    asks_from: from,
  };
}

module.exports = { quoteOf };
