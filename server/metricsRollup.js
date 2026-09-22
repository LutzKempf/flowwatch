const { phaseForEvent } = require('./sessions/phaseDetector');
const { PHASE, PHASE_COUNT } = require('./sessions/phases');

/** @returns {{work_ms: number, wait_ms: number, inputs: number, tokens_usd: number, tokens: number}} */
function blank() {
  return { work_ms: 0, wait_ms: 0, inputs: 0, tokens_usd: 0, tokens: 0 };
}

/**
 * Folds a session's event stream into per-phase work/wait/inputs/token stats.
 * @param {Array<{type:string, ts:number, costUsd?: number, tokensTotal?: number}>} events sorted by ts, ascending
 * @returns {Object<number, ReturnType<typeof blank>>}
 */
function rollup(events) {
  /** @type {Object<number, ReturnType<typeof blank>>} */
  const stats = {};
  for (let p = 1; p <= PHASE_COUNT; p++) stats[p] = blank();

  let cur = PHASE.GOAL;
  let lastPrompt = null; // ts of the operator prompt currently being worked
  let lastStop = null; // ts the agent last went idle (waiting on you)
  let lastCost = null; // last cumulative costUsd seen (live statusLine feed)
  let lastTokens = null; // last cumulative tokensTotal seen (backfill transcript feed)

  for (const ev of events) {
    const p = phaseForEvent(ev);
    if (p && p > cur) cur = p; // advance phase (monotonic)

    if (ev.type === 'user_prompt') {
      stats[cur].inputs += 1;
      if (lastStop != null) stats[cur].wait_ms += ev.ts - lastStop;
      // A prompt with no intervening turn_stop = the user interrupted a working
      // agent; credit the elapsed work before restarting the clock.
      if (lastPrompt != null) stats[cur].work_ms += ev.ts - lastPrompt;
      lastPrompt = ev.ts;
      lastStop = null;
    } else if (ev.type === 'turn_stop') {
      if (lastPrompt != null) stats[cur].work_ms += ev.ts - lastPrompt;
      lastStop = ev.ts;
      lastPrompt = null;
    } else if (ev.type === 'token_usage') {
      // The FIRST sample of each cumulative series is a baseline only: spend from before Flowwatch saw the
      // session is never attributed to the current phase. Two parallel series, both read: costUsd (the live
      // status line) and tokensTotal (backfilled transcripts), so a backfilled session never reads $0/0.
      if (typeof ev.costUsd === 'number') {
        if (lastCost != null && ev.costUsd >= lastCost) stats[cur].tokens_usd += ev.costUsd - lastCost;
        lastCost = ev.costUsd;
      }
      if (typeof ev.tokensTotal === 'number') {
        if (lastTokens != null && ev.tokensTotal >= lastTokens) stats[cur].tokens += ev.tokensTotal - lastTokens;
        lastTokens = ev.tokensTotal;
      }
    }
  }
  return stats;
}

module.exports = { rollup };
