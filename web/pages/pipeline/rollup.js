// The two rollups under the board: per phase across every session, and the archived sessions.
import { PHASES, rbar, tile, tokCell } from './format.js';

/* ---- archived-session rollup ---- */
// Rendered from the server-precomputed data.history, NOT from window.SESS — the
// archived sessions are filtered out of SESS before it is ever built.
export function renderHistory(h) {
  const el = document.getElementById('history');
  if (!el) return;
  if (!h || !h.sessions) {
    el.innerHTML = '<p class="hint">No archived sessions yet.</p>';
    return;
  }
  // Absent is not zero, here as in the live tiles: with no measured time,
  // "0% / 100%" asserts that the agent did nothing and the operator waited
  // throughout — a strong claim built from no data at all.
  const total = h.workMs + h.waitMs;
  const pctW = total ? Math.round((100 * h.workMs) / total) : null;
  el.innerHTML =
    '<div class="grid g4">' +
    tile(h.sessions, 'archived sessions', 'no events for over 7 days', 'var(--ink)') +
    tile(h.worktrees, 'worktrees', 'distinct, across all archived work', 'var(--ink)') +
    tile(h.inputs.toLocaleString(), 'operator inputs', 'times a session paused for you', 'var(--violet)') +
    tile(
      pctW == null ? '—' : pctW + '% / ' + (100 - pctW) + '%',
      'agent-work / you-wait',
      total ? 'of wall-clock time in-pipeline' : 'no time measured yet',
      'var(--cyan)'
    ) +
    '</div>';
}

/* ---- aggregate rollup - the server pins score + the ONE target:true row ---- */
export function renderRollup() {
  const AGG = window.AGG || [];
  const nowPhases = new Set(window.SESS.map((s) => s.cur));
  document.getElementById('agg-rollup').innerHTML = AGG.map((a) => {
    const i = a.phase - 1;
    const empty = !(a.work_ms || a.wait_ms || a.inputs || a.tokens_usd || a.tokens);
    const cls = a.target ? 'tgt' : nowPhases.has(a.phase) ? 'now' : empty ? 'dimr' : '';
    const flag = a.target ? '<span class="flag f-tgt">\u2605 target</span>' : '';
    return (
      '<tr class="' +
      cls +
      '">' +
      '<td class="pname"><b>' +
      a.phase +
      ' ' +
      PHASES[i][0] +
      '</b><small>' +
      PHASES[i][1] +
      '</small></td>' +
      '<td>' +
      (a.sessions || 0) +
      '</td>' +
      '<td>' +
      (empty ? '\u2014' : Math.round(a.work_ms / 60000) + 'm') +
      '</td>' +
      '<td style="color:' +
      (a.wait_ms >= 10 * 60000 ? 'var(--violet)' : 'inherit') +
      '">' +
      (empty ? '\u2014' : Math.round(a.wait_ms / 60000) + 'm') +
      '</td>' +
      '<td>' +
      (empty ? '\u2014' : tokCell(a.tokens_usd, a.tokens)) +
      '</td>' +
      '<td>' +
      rbar(null) +
      '</td>' +
      '<td style="color:' +
      (a.inputs >= 9 ? 'var(--amber)' : 'inherit') +
      '">' +
      (empty ? '\u2014' : a.inputs) +
      '</td>' +
      '<td style="text-align:left">' +
      flag +
      '</td></tr>'
    );
  }).join('');
}
