/**
 * Which lane a spec capability belongs to.
 *
 * The repo names this itself: MISSION.md's Categories section can give each category the openspec capabilities
 * it owns ("- Checkout — specs: checkout-flow, cart-*"). Those owners decide first — exact names before `prefix-*`
 * patterns — and the repo's category inference (flowwatch.json "sessions.categorize") is only the fallback for
 * capabilities no category owns. Inference alone misfiles: a pattern for one lane can match a capability another
 * lane owns by name.
 */

/**
 * @param {Object<string, string[]>} categorySpecs parseMission's categorySpecs: category -> the specs it owns
 * @returns {{exact: Map<string,string>, prefixes: Array<[string,string]>}} empty when no category owns a spec
 */
function ownerTable(categorySpecs) {
  const exact = new Map();
  /** @type {Array<[string, string]>} */
  const prefixes = [];
  for (const [category, specs] of Object.entries(categorySpecs || {})) {
    for (const name of specs) {
      if (name.endsWith('*')) prefixes.push([name.slice(0, -1), category]);
      else if (!exact.has(name)) exact.set(name, category);
    }
  }
  return { exact, prefixes };
}

/**
 * @param {string} capability
 * @param {{table: ReturnType<typeof ownerTable>, inferCategory: (s: string) => string|null}} deps
 * @returns {{lane: string|null, from: 'categories'|'inferred'|null}}
 */
function capabilityLane(capability, { table, inferCategory }) {
  const exact = table.exact.get(capability);
  if (exact) return { lane: exact, from: 'categories' };
  const prefix = table.prefixes.find(([p]) => capability.startsWith(p));
  if (prefix) return { lane: prefix[1], from: 'categories' };
  const inferred = inferCategory(capability);
  return inferred ? { lane: inferred, from: 'inferred' } : { lane: null, from: null };
}

module.exports = { ownerTable, capabilityLane };
