/**
 * The small checks the feed formats share (stages, ideas, gates). Each format's own check names its fields;
 * these only say what a field's value must look like.
 */

/**
 * A non-empty piece of text: an id, a name, a label.
 * @type {(v: unknown) => boolean}
 */
const isName = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * Absent (undefined or null), or passing `ok`: an optional field.
 * @type {(v: any, ok: (v: any) => boolean) => boolean}
 */
const optional = (v, ok) => v === undefined || v === null || ok(v);

/**
 * An optional list of sentences, such as a feed's warnings.
 * @param {unknown} list
 * @param {string} key its name in the feed
 * @returns {string[]} the problems with it; none when it is absent
 */
function listOfSentences(list, key) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) return ['"' + key + '" must be a list of sentences'];
  return list.flatMap((s, i) => (typeof s === 'string' ? [] : [key + '[' + i + '] must be a sentence']));
}

module.exports = { isName, optional, listOfSentences };
