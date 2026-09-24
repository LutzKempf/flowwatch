const { PHASE } = require('./phases');

// A shell command that runs tests: the common runners, including a package script named test or test:<tier>.
const TEST_COMMAND = /\b(?:(?:npm|yarn|pnpm|bun) (?:run )?test|jest|vitest|pytest|go test|cargo test)\b/;

/**
 * @typedef {{type: string, name?: string, path?: string, touchesCode?: boolean|null, command?: string}} PhaseEvent
 *   the fields of an event that say which phase it implies
 */

/**
 * Maps one event to the pipeline phase it implies, if any.
 * @param {PhaseEvent} ev the event
 * @returns {number|null} a PHASE number, or null when the event is not a phase signal
 */
function phaseForEvent(ev) {
  switch (ev.type) {
    case 'session_start':
      return PHASE.GOAL;
    case 'skill': {
      // The Skill hook records plugin-namespaced names ('superpowers:brainstorming'),
      // so compare the bare name — an === against 'brainstorming' would silently drop
      // every namespaced invocation.
      const name = String(ev.name || '')
        .split(':')
        .pop();
      if (name === 'brainstorming') return PHASE.BRAINSTORM;
      if (name === 'cleanup') return PHASE.CLEANUP;
      return null;
    }
    case 'file_change': {
      // Windows emitters send backslash paths — normalize before matching.
      const p = (ev.path || '').replace(/\\/g, '/');
      // A plan: tasks.md, or a markdown file in a plans/ folder (docs/superpowers/plans/, docs/plans/).
      if (/(?:tasks\.md|\/plans\/[^/]+\.md)$/.test(p)) return PHASE.PLAN;
      if (/openspec\/changes\//.test(p)) return PHASE.OPENSPEC;
      return null;
    }
    // A backfilled commit has no git context to resolve touchesCode against, so the
    // field is absent. Only an explicit false — a resolved docs-only commit — is
    // evidence AGAINST Execute; unknown must not read as "no code was written".
    case 'commit':
      return ev.touchesCode === false ? null : PHASE.EXECUTE;
    case 'bash':
      if (/\bgh pr create\b/.test(/** @type {string} */ (ev.command))) return PHASE.PR;
      if (TEST_COMMAND.test(/** @type {string} */ (ev.command))) return PHASE.TEST;
      return null;
    case 'gate_pass':
      return PHASE.PR_GREEN;
    // A per-change pass marker is a check beside the pre-merge check on the PR that completes
    // a change — same phase as gate_pass.
    case 'goal_pass':
      return PHASE.PR_GREEN;
    case 'merge':
      return PHASE.MERGE;
    case 'verify':
      return PHASE.VERIFY;
    case 'worktree_remove':
      return PHASE.CLEANUP;
    default:
      return null;
  }
}

/**
 * Monotonic: the current phase is the furthest phase any event has implied.
 * @param {PhaseEvent[]} events a session's events (any order)
 * @returns {number} the highest PHASE any event implied (min: GOAL)
 */
function detectPhase(events) {
  let cur = PHASE.GOAL;
  for (const ev of events) {
    const p = phaseForEvent(ev);
    if (p && p > cur) cur = p;
  }
  return cur;
}

module.exports = { phaseForEvent, detectPhase };
