const { phaseForEvent } = require('./sessions/phaseDetector');
const { PHASE, PHASE_COUNT } = require('./sessions/phases');

// The version of the rule below. Each session's roll-up is STORED (phase_stats) and redone only when the session
// gets a new event, so a changed rule would leave every finished session showing the old one's numbers. Raise this
// whenever the rule changes: the collector redoes every stored roll-up once, at its next start.
const ROLLUP_VERSION = 3;

/**
 * @returns {{work_ms: number, wait_ms: number, inputs: number, tokens_usd: number, tokens: number, entered: boolean}}
 */
function blank() {
  return { work_ms: 0, wait_ms: 0, inputs: 0, tokens_usd: 0, tokens: 0, entered: false };
}

/**
 * Folds a session's event stream into per-phase work/wait/inputs/token stats, and which phases it was in.
 *
 * A turn (prompt to stop) is split at every moment its phase moved: each phase gets the minutes spent in it, and the
 * tokens spent in that stretch. Credited whole at the turn's end instead, every minute of an agent's long autonomous
 * turn landed on the phase it ENDED in, and each phase it passed through read 0m.
 * @param {Array<{type:string, ts:number, costUsd?: number, tokensTotal?: number}>} events sorted by ts, ascending
 * @returns {Object<number, ReturnType<typeof blank>>}
 */
function rollup(events) {
  /** @type {Object<number, ReturnType<typeof blank>>} */
  const stats = {};
  for (let p = 1; p <= PHASE_COUNT; p++) stats[p] = blank();

  let cur = PHASE.GOAL;
  stats[cur].entered = true;
  /** @type {number|null} */
  let workFrom = null; // ts from which the running turn's time is not yet credited (null: no turn running)
  let lastStop = null; // ts the agent last went idle (waiting on you)
  let lastCost = null; // last cumulative costUsd seen (live statusLine feed)
  let lastTokens = null; // last cumulative tokensTotal seen (backfill transcript feed)
  /** @param {number} ts credits the running turn's time up to ts to the current phase */
  const creditWork = (ts) => {
    if (workFrom != null) stats[cur].work_ms += ts - workFrom;
  };

  for (const ev of events) {
    const p = phaseForEvent(ev);
    if (p && p > cur) {
      // advance phase (monotonic), closing the running turn's stretch in the phase it leaves
      creditWork(ev.ts);
      if (workFrom != null) workFrom = ev.ts;
      cur = p;
      stats[cur].entered = true;
    }

    if (ev.type === 'user_prompt') {
      stats[cur].inputs += 1;
      if (lastStop != null) stats[cur].wait_ms += ev.ts - lastStop;
      // A prompt with no intervening turn_stop = the user interrupted a working
      // agent; credit the elapsed work before restarting the clock.
      creditWork(ev.ts);
      workFrom = ev.ts;
      lastStop = null;
    } else if (ev.type === 'turn_stop') {
      creditWork(ev.ts);
      lastStop = ev.ts;
      workFrom = null;
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

module.exports = { rollup, ROLLUP_VERSION };
