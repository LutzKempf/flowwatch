const { phaseForEvent } = require('./sessions/phaseDetector');
const { PHASE, PHASE_COUNT } = require('./sessions/phases');

// The version of the rule below. Each session's roll-up is STORED (phase_stats) and redone only when the session
// gets a new event, so a changed rule would leave every finished session showing the old one's numbers. Raise this
// whenever the rule changes: the collector redoes every stored roll-up once, at its next start.
const ROLLUP_VERSION = 2;

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
  // A turn's spend, held until the turn ends. Work is credited at the turn's END (to the phase current then), so
  // spend credited as it arrived would land on the phase the turn STARTED in whenever the phase moved mid-turn:
  // one turn split across two rows, "0m work, 96k tokens" beside "14m work, 15k tokens", neither of them true.
  let pendingUsd = 0;
  let pendingTokens = 0;
  const creditTurn = () => {
    stats[cur].tokens_usd += pendingUsd;
    stats[cur].tokens += pendingTokens;
    pendingUsd = 0;
    pendingTokens = 0;
  };

  for (const ev of events) {
    const p = phaseForEvent(ev);
    if (p && p > cur) cur = p; // advance phase (monotonic)

    if (ev.type === 'user_prompt') {
      stats[cur].inputs += 1;
      if (lastStop != null) stats[cur].wait_ms += ev.ts - lastStop;
      // A prompt with no intervening turn_stop = the user interrupted a working
      // agent; credit the elapsed work before restarting the clock.
      if (lastPrompt != null) stats[cur].work_ms += ev.ts - lastPrompt;
      creditTurn();
      lastPrompt = ev.ts;
      lastStop = null;
    } else if (ev.type === 'turn_stop') {
      if (lastPrompt != null) stats[cur].work_ms += ev.ts - lastPrompt;
      creditTurn();
      lastStop = ev.ts;
      lastPrompt = null;
    } else if (ev.type === 'token_usage') {
      // The FIRST sample of each cumulative series is a baseline only: spend from before Flowwatch saw the
      // session is never attributed to the current phase. Two parallel series, both read: costUsd (the live
      // status line) and tokensTotal (backfilled transcripts), so a backfilled session never reads $0/0.
      if (typeof ev.costUsd === 'number') {
        if (lastCost != null && ev.costUsd >= lastCost) pendingUsd += ev.costUsd - lastCost;
        lastCost = ev.costUsd;
      }
      if (typeof ev.tokensTotal === 'number') {
        if (lastTokens != null && ev.tokensTotal >= lastTokens) pendingTokens += ev.tokensTotal - lastTokens;
        lastTokens = ev.tokensTotal;
      }
    }
  }
  creditTurn(); // a turn still running, or spend after the last turn ended, belongs to the phase reached
  return stats;
}

module.exports = { rollup, ROLLUP_VERSION };
