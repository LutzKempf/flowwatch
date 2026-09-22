/**
 * The written half of a session's state: what the session is doing, from its
 * events alone.
 *
 * Staleness and archiving are NOT decided here — they depend on the wall clock,
 * so a value written at ingest time would be wrong a minute later. They are
 * derived per-request in buildPipeline().
 * @param {Array<{type:string}>} events chronological session events
 * @returns {'waiting'|'working'}
 */
function stateForEvents(events) {
  const last = events[events.length - 1];
  return last && last.type === 'turn_stop' ? 'waiting' : 'working';
}

module.exports = { stateForEvents };
