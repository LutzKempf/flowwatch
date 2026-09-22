const { rollup } = require('../../../server/metricsRollup');
const { PHASE } = require('../../../server/sessions/phases');

test('work vs wait split, inputs, and token deltas land on the current phase', () => {
  const ev = [
    { type: 'session_start', ts: 0 },
    { type: 'token_usage', ts: 500, costUsd: 0.05 }, // FIRST sample = baseline only, attributes NOTHING
    { type: 'user_prompt', ts: 1000 }, // goal: prompt
    { type: 'token_usage', ts: 1500, costUsd: 0.15 }, // +0.10 in GOAL
    { type: 'turn_stop', ts: 5000 }, // work 4000ms in GOAL
    // you wait 3000ms, then a new prompt; the agent then invokes the brainstorming skill
    { type: 'skill', name: 'brainstorming', ts: 8000 }, // BRAINSTORM begins (advances cur FIRST)
    { type: 'user_prompt', ts: 8000 }, // input #2 + the 3000ms wait — attributed to the CURRENT
    // phase at prompt time (BRAINSTORM here, since the skill
    // event sorts first at the same ts). The pinned rule:
    // wait/input belong to the phase current when the prompt lands.
    { type: 'turn_stop', ts: 9000 }, // work 1000ms in BRAINSTORM
    { type: 'token_usage', ts: 9000, costUsd: 0.45 }, // +0.30 in BRAINSTORM
  ];
  const s = rollup(ev);
  expect(s[PHASE.GOAL].work_ms).toBe(4000);
  expect(s[PHASE.GOAL].wait_ms).toBe(0);
  expect(s[PHASE.BRAINSTORM].wait_ms).toBe(3000);
  expect(s[PHASE.GOAL].inputs).toBe(1);
  expect(s[PHASE.BRAINSTORM].work_ms).toBe(1000);
  expect(s[PHASE.BRAINSTORM].inputs).toBe(1);
  expect(Math.round(s[PHASE.GOAL].tokens_usd * 100)).toBe(10); // NOT 15 — the baseline 0.05 is never attributed
  expect(Math.round(s[PHASE.BRAINSTORM].tokens_usd * 100)).toBe(30);
});

test('tokensTotal (backfill token counts) rides the same baseline+delta rule as costUsd', () => {
  // Backfilled sessions emit {type:'token_usage', tokensTotal} — no costUsd.
  // The roll-up must consume BOTH fields or backfilled cost is silently zero.
  const ev = [
    { type: 'session_start', ts: 0 },
    { type: 'token_usage', ts: 100, tokensTotal: 150 }, // baseline
    { type: 'user_prompt', ts: 200 },
    { type: 'token_usage', ts: 300, tokensTotal: 430 }, // +280 in GOAL
  ];
  const s = rollup(ev);
  expect(s[PHASE.GOAL].tokens).toBe(280);
});

test('a prompt arriving mid-turn (user interrupt) still credits the elapsed work', () => {
  // prompt@1000, prompt@4000 (no turn_stop between — interrupt), turn_stop@5000:
  // 3000ms credited at the interrupting prompt + 1000ms at the stop = 4000ms total.
  const ev = [
    { type: 'user_prompt', ts: 1000 },
    { type: 'user_prompt', ts: 4000 },
    { type: 'turn_stop', ts: 5000 },
  ];
  const s = rollup(ev);
  expect(s[PHASE.GOAL].work_ms).toBe(4000);
});
