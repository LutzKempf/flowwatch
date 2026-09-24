// The two rollups under the board: per phase across every session, and the archived sessions.
import { PHASES, tile, tokCell } from './format.js';

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
  el.innerHTML =
    '<div class="grid g3">' +
    tile(h.sessions, 'archived sessions', 'no events for over 7 days', 'var(--ink)') +
    tile(h.worktrees, 'worktrees', 'distinct, across all archived work', 'var(--ink)') +
    tile(h.inputs.toLocaleString(), 'operator inputs', 'times a session paused for you', 'var(--violet)') +
    '</div>';
}

/* ---- aggregate rollup - the server pins score + the ONE target:true row ---- */
export function renderRollup() {
  const AGG = window.AGG || [];
  const nowPhases = new Set(window.SESS.map((s) => s.cur));
  document.getElementById('agg-rollup').innerHTML = AGG.map((a) => {
    const i = a.phase - 1;
    const empty = !(a.work_ms || a.inputs || a.tokens_usd || a.tokens);
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
      '<td>' +
      (empty ? '\u2014' : tokCell(a.tokens_usd, a.tokens)) +
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
