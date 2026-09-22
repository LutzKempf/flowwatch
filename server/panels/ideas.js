/**
 * The ideas feed: every idea a repo has evaluated, grouped in the repo's own sections, each with its verdict
 * in the repo's words and the bucket that verdict falls in. Flowwatch counts the buckets and finds each
 * section's latest date itself, so a feed can never show counts its ideas do not add up to.
 *
 * Format 1: `{ "format": 1, "source"?: "where the ideas are kept", "sections": [{ "title", "ideas": [{ "n"?,
 * "name", "verdict", "bucket", "evidence"?, "date"?: "YYYY-MM-DD", "docs"? }] }], "warnings"?: [sentences] }`,
 * with `bucket` one of BUCKETS.
 */
const { isName, optional, listOfSentences } = require('./formatChecks');

const BUCKETS = ['closed', 'inconclusive', 'open', 'unclassified'];

/**
 * @typedef {{n?: number, name: string, verdict: string, bucket: string, evidence?: string, date?: string,
 *   docs?: string}} Idea
 * @typedef {{source?: string, sections: Array<{title: string, ideas: Idea[]}>, warnings?: string[]}} IdeasFeed
 */

/** @type {(v: unknown) => boolean} */
const isText = (v) => typeof v === 'string';
/**
 * A real day written YYYY-MM-DD: "2026-02-30" has the shape and is not one.
 * @type {(d: unknown) => boolean}
 */
const isDay = (d) =>
  typeof d === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(d) &&
  !Number.isNaN(Date.parse(d)) &&
  new Date(d).toISOString().slice(0, 10) === d;

/**
 * @param {any} data a parsed ideas feed, not yet checked
 * @returns {string[]} what does not match the format; empty when it matches
 */
function checkIdeas(data) {
  /** @type {string[]} */
  const problems = optional(data.source, isText) ? [] : ['"source" must be text'];
  if (!Array.isArray(data.sections)) return [...problems, '"sections" must be a list'];
  data.sections.forEach((/** @type {any} */ s, /** @type {number} */ i) => {
    const at = 'sections[' + i + ']';
    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      problems.push(at + ' must be an object');
      return;
    }
    if (!isName(s.title)) problems.push(at + '.title must be a name');
    if (!Array.isArray(s.ideas)) {
      problems.push(at + '.ideas must be a list');
      return;
    }
    s.ideas.forEach((/** @type {any} */ idea, /** @type {number} */ j) =>
      problems.push(...ideaProblems(idea, at + '.ideas[' + j + ']'))
    );
  });
  return [...problems, ...listOfSentences(data.warnings, 'warnings')];
}

/**
 * @param {any} idea one idea of the feed, not yet checked
 * @param {string} at where it is, for the problems' wording
 * @returns {string[]}
 */
function ideaProblems(idea, at) {
  if (!idea || typeof idea !== 'object' || Array.isArray(idea)) return [at + ' must be an object'];
  /** @type {string[]} */
  const problems = [];
  if (!optional(idea.n, (n) => Number.isInteger(n) && n >= 0)) problems.push(at + '.n must be a whole number');
  if (!isName(idea.name)) problems.push(at + '.name must be a name');
  if (!isName(idea.verdict)) problems.push(at + '.verdict must be a sentence');
  if (!BUCKETS.includes(idea.bucket)) problems.push(at + '.bucket must be one of ' + BUCKETS.join(', '));
  if (!optional(idea.date, isDay)) problems.push(at + '.date must be a day written YYYY-MM-DD');
  if (!optional(idea.evidence, isText)) problems.push(at + '.evidence must be text');
  if (!optional(idea.docs, isText)) problems.push(at + '.docs must be text');
  return problems;
}

/**
 * The ideas payload: the feed's sections, each with the counts and latest date Flowwatch made from its ideas
 * (whatever the feed wrote for either), and never the format number.
 * @param {IdeasFeed|null} data an ideas feed that passed checkIdeas, or null when the panel has none
 * @returns {{source: string|null, sections: Array<{title: string, ideas: Idea[], counts: Object<string, number>,
 *   latest: string|null}>, warnings: string[]}|null}
 */
function ideasPayload(data) {
  if (!data) return null;
  return {
    source: data.source || null,
    sections: data.sections.map((s) => {
      const counts = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
      for (const i of s.ideas) counts[i.bucket] += 1;
      return {
        title: s.title,
        ideas: s.ideas,
        counts,
        latest:
          s.ideas
            .map((i) => i.date)
            .filter(Boolean)
            .sort()
            .pop() || null,
      };
    }),
    warnings: data.warnings || [],
  };
}

module.exports = { checkIdeas, ideasPayload, BUCKETS };
