/**
 * The value feed: the figures a repo wants at the top of its Mission page, measured in outcomes rather than
 * merged pull requests. Each figure is a sentence the repo words itself — `**…**` marks the parts shown bold
 * — because only the repo knows whether a missing number means "none yet" or "not recorded".
 *
 * Format 1: `{ "format": 1, "figures": [{ "text": "**3 of 9** workstreams ship", "tone": "good" }] }`, with
 * 1 to 8 figures and `tone` one of good, bad, warn, neutral (neutral when absent).
 */

const TONES = ['good', 'bad', 'warn', 'neutral'];
const MAX_FIGURES = 8;
const MAX_TEXT = 200;

/**
 * @param {any} data a parsed value feed, not yet checked
 * @returns {string[]} what does not match the format; empty when it matches
 */
function checkValue(data) {
  if (!Array.isArray(data.figures)) return ['"figures" must be a list'];
  if (data.figures.length === 0) return ['"figures" is empty'];
  if (data.figures.length > MAX_FIGURES)
    return ['"figures" has ' + data.figures.length + ' entries; at most ' + MAX_FIGURES];
  /** @type {string[]} */
  const problems = [];
  data.figures.forEach((/** @type {any} */ f, /** @type {number} */ i) => {
    const text = f && f.text;
    if (typeof text !== 'string' || !text.trim()) problems.push('figures[' + i + '].text must be a sentence');
    else if (text.length > MAX_TEXT)
      problems.push('figures[' + i + '].text has ' + text.length + ' characters; at most ' + MAX_TEXT);
    if (f && f.tone !== undefined && !TONES.includes(f.tone))
      problems.push('figures[' + i + '].tone must be one of ' + TONES.join(', '));
  });
  return problems;
}

module.exports = { checkValue, TONES };
