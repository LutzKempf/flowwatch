#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { buildEvent, emit, LOG_DIR } = require('./lib/pipelineEmit');
const { worktreeOf } = require('./lib/mapHookEvent');

const STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Delete `.last-cost-*` dedupe state files older than 7 days, so finished sessions do not
 * leave files behind forever. Best-effort: runs only on the rare changed-cost path, never throws.
 * @param {string} dir log dir holding the state files
 */
function pruneStaleState(dir) {
  try {
    const cutoff = Date.now() - STATE_MAX_AGE_MS;
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith('.last-cost-')) continue;
      const full = path.join(dir, f);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
      } catch {
        /* races are fine */
      }
    }
  } catch {
    /* fail-open */
  }
}

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  /** @type {Record<string, any>} */
  let s = {};
  try {
    s = JSON.parse(raw);
  } catch {
    /* ignore */
  }
  const cost = s.cost && typeof s.cost.total_cost_usd === 'number' ? s.cost.total_cost_usd : null;
  try {
    if (cost != null && s.session_id) {
      // Dedupe: the statusline renders far more often than cost moves — an
      // unchanged cost re-emit is a no-information event flooding the collector.
      const stateFile = path.join(LOG_DIR, '.last-cost-' + String(s.session_id).replace(/[^\w.-]/g, '_'));
      let last = null;
      try {
        last = fs.readFileSync(stateFile, 'utf8');
      } catch {
        /* first emit for this session */
      }
      if (last !== String(cost)) {
        emit(buildEvent({ session_id: s.session_id, worktree: worktreeOf(s.cwd), type: 'token_usage', costUsd: cost }));
        fs.mkdirSync(LOG_DIR, { recursive: true });
        fs.writeFileSync(stateFile, String(cost));
        pruneStaleState(LOG_DIR);
      }
    }
  } catch {
    /* fail-open */
  }
  // Always print a status line so the feature is invisible to the user's terminal UX.
  process.stdout.write(cost != null ? `$${cost.toFixed(2)}` : '');
  // No process.exit(0): it would end the process before the fire-and-forget token_usage POST's
  // socket flushes, as in hooks/emit.js. The POST's 500 ms socket timeout bounds the natural exit.
  process.exitCode = 0;
});
