/**
 * The two rules the setup check and the pages share. Pure: the caller reads the files and passes what it
 * found.
 */

/** @typedef {{state: 'off'|'not-set-up'|'error'|'data', reason?: string}} PanelState */

/**
 * The state of a panel whose source comes from flowwatch.json.
 * @param {{config?: Record<string, any>|null, configError?: string|null, key: string}} input the parsed file
 *   (null when there is none), its parse error, and the panel's key
 * @returns {PanelState} `off`: the repo says it does not
 *   use the panel (`"key": false`), which takes it out of the sidebar; `not-set-up`: nothing says either way
 */
function panelState({ config, configError, key }) {
  if (configError) return { state: 'error', reason: 'flowwatch.json is not valid JSON: ' + configError };
  const value = config ? config[key] : undefined;
  if (value === false) return { state: 'off' };
  if (value === undefined || value === null) return { state: 'not-set-up' };
  return { state: 'data' };
}

/**
 * What the setup banner lists, and whether it shows (it shows when the list is not empty). It is raised
 * only by a required item that is not ok — the mission, its problems, the hooks; once raised it lists
 * everything that needs doing, required first. Optional panels alone never raise it.
 * @param {Array<{id: string, state: string, required: boolean}>} items the setup check's items
 * @returns {Array<{id: string, state: string, required: boolean}>} the items to list; empty = no banner
 */
function bannerItems(items) {
  const needs = (/** @type {{state: string}} */ i) => i.state !== 'ok' && i.state !== 'off';
  if (!items.some((i) => i.required && needs(i))) return [];
  return [...items.filter((i) => i.required && needs(i)), ...items.filter((i) => !i.required && needs(i))];
}

module.exports = { panelState, bannerItems };
