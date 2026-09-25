const { phaseForEvent } = require('./sessions/phaseDetector');
const { PHASE, PHASE_COUNT } = require('./sessions/phases');

// The version of the rule below. Each session's roll-up is STORED (phase_stats) and redone only when the session
// gets a new event, so a changed rule would leave every finished session showing the old one's numbers. Raise this
// whenever the rule changes: the collector redoes every stored roll-up once, at its next start.
const ROLLUP_VERSION = 5;

// The longest silence inside a turn that still counts as work. A single tool call runs for at most 10 minutes, so a
// longer silence is not the agent working: it is a session left open -- on a permission prompt, with the lid closed,
// or after a turn whose stop was never recorded. Each such silence counts for this much, no more.
const IDLE_MS = 15 * 60 * 1000;

/**
 * @returns {{work_ms: number, wait_ms: number, inputs: number, tokens_usd: number, tokens: number, entered: boolean}}
 */
function blank() {
  return { work_ms: 0, wait_ms: 0, inputs: 0, tokens_usd: 0, tokens: 0, entered: false };
}

/**
 * Folds a session's event stream into per-phase work/wait/inputs/token stats, and which phases it was in.
 *
 * A turn (prompt to stop) is work from event to event: each phase gets the minutes spent in it, and the tokens spent
 * in that stretch. Credited whole at the turn's end instead, every minute of an agent's long autonomous turn landed on
 * the phase it ENDED in, and each phase it passed through read 0m. No silence inside a turn counts for more than
 * IDLE_MS, so a session left open for days is not days of work. A question or a permission prompt (`waiting`) pauses
 * the turn without ending it -- Claude Code fires no Stop while one waits -- and the pause is the operator's time:
 * work stops at the question, and the wait runs until the answer (`answered`) or the next sign of activity.
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
  let workFrom = null; // ts of the running turn's last event (null: no turn running)
  let lastStop = null; // ts the agent last went idle (waiting on you)
  let lastCost = null; // last cumulative costUsd seen (live statusLine feed)
  let lastTokens = null; // last cumulative tokensTotal seen (backfill transcript feed)
  /** @type {number|null} */
  let pausedAt = null; // ts a question or permission prompt paused the running turn (null: not paused)

  for (const ev of events) {
    // The stretch since the running turn's last event, to the phase it was spent in -- before this event can move it.
    if (workFrom != null) {
      stats[cur].work_ms += Math.min(ev.ts - workFrom, IDLE_MS);
      workFrom = ev.ts;
    }
    // A pause ends at the next event that is not the same pause announced again (a question is followed by its
    // permission_prompt notification): the wait is the operator's, and an answer or approval is one of their inputs.
    if (pausedAt != null && ev.type !== 'waiting') {
      stats[cur].wait_ms += ev.ts - pausedAt;
      pausedAt = null;
      if (ev.type !== 'user_prompt' && ev.type !== 'turn_stop') {
        stats[cur].inputs += 1;
        workFrom = ev.ts;
      }
    }
    const p = phaseForEvent(ev);
    if (p && p > cur) {
      cur = p; // advance phase (monotonic)
      stats[cur].entered = true;
    }

    if (ev.type === 'user_prompt') {
      stats[cur].inputs += 1;
      if (lastStop != null) stats[cur].wait_ms += ev.ts - lastStop;
      // A prompt with no intervening turn_stop (the user interrupted, or the stop was never recorded) has had the
      // elapsed work credited above, silence capped; the new turn starts here.
      workFrom = ev.ts;
      lastStop = null;
    } else if (ev.type === 'turn_stop') {
      lastStop = ev.ts;
      workFrom = null;
    } else if (ev.type === 'waiting' && workFrom != null) {
      pausedAt = ev.ts; // the work clock stops here; a waiting with no turn running changes nothing
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

module.exports = { rollup, ROLLUP_VERSION, IDLE_MS };
