// Words and numbers as the Pipeline page writes them: the twelve phases, the lane states, times, token counts, a
// session's title and the facts about it. Shared by the board, the side panel, the rollups, Cleanup and the gates.

// In the demo nobody can open the operator's sessions, so nothing links into the Claude app.
export const IN_APP = !Data.demo;

export const PHASES = [
  ['Goal', 'milestone'],
  ['Brainstorm', 'design'],
  ['OpenSpec', 'specs'],
  ['Plan', 'tasks.md'],
  ['Execute', 'code'],
  ['Test+Hunt', 'dev+bugs'],
  ['PR', 'create'],
  ['PR green', 'CI gate'],
  ['Merge', '+deploy'],
  ['Verify', 'on prod'],
  ['Cleanup', 'teardown'],
  ['Done', '\u2713'],
];
export const stateLabel = {
  work: 'working',
  waityou: 'waiting on you',
  machwait: 'CI running',
  abandoned: 'ended mid-turn',
};
export const STATE_MAP = {
  working: 'work',
  work: 'work',
  waiting: 'waityou',
  waityou: 'waityou',
  machwait: 'machwait',
  abandoned: 'abandoned',
};

// escapeHtml comes from /lib/render.js (shared with the Mission page — no duplicate escaper)
export function tokCell(usd, tok) {
  // live sessions have costUsd (show cents); backfilled have token counts (show k-tokens)
  if (usd > 0) return Math.round(usd * 100) + '\u00a2';
  if (tok > 0) return Math.round(tok / 1000) + 'k';
  return '\u2014';
}

export function tile(n, l, s, c) {
  return (
    '<div class="stat"><div class="n" style="color:' +
    c +
    '">' +
    n +
    '</div><div class="l">' +
    l +
    '</div><div class="s">' +
    s +
    '</div></div>'
  );
}

export const NO_CATEGORY = 'No category';

function fmtDur(ms) {
  const m = (ms || 0) / 60000;
  if (m < 60) return Math.round(m) + 'm';
  const h = m / 60;
  return h < 48 ? (h < 10 ? h.toFixed(1) : Math.round(h)) + 'h' : (h / 24).toFixed(1) + 'd';
}
function fmtTok(n) {
  const v = n || 0;
  return v < 1000 ? String(v) : v < 1e6 ? Math.round(v / 1000) + 'k' : (v / 1e6).toFixed(1) + 'M';
}
export function age(h) {
  return h < 1 ? 'just now' : h < 48 ? h + 'h' : Math.round(h / 24) + 'd';
}

// "Retro: fix the gate" in the Retro lane reads as "fix the gate": the category is already a column.
export function displayTitle(it) {
  const m = String(it.title || '').match(/^\s*([A-Za-z][A-Za-z0-9_-]{1,24})\s*:\s*(.+)$/);
  const norm = (s) =>
    String(s)
      .toLowerCase()
      .replace(/[\s_-]/g, '');
  return m && it.category && norm(m[1]) === norm(it.category) ? m[2] : it.title || '(untitled)';
}

export function factTags(it) {
  const tags = [];
  if (it.routine) tags.push('scheduled routine run');
  if (it.state === 'abandoned') tags.push('ended mid-turn');
  else if (it.api_error || it.app_error) tags.push('error');
  if (it.pending_question) tags.push('asked with the question tool');
  else if (it.asks) tags.push('asks something');
  if (it.phase) tags.push('phase ' + it.phase + ' ' + PHASES[it.phase - 1][0]);
  if (it.pr && it.pr.numbers.length) tags.push('PR #' + it.pr.numbers.join(', #') + ' ' + it.pr.status);
  if (it.totals) tags.push(fmtDur(it.totals.work_ms) + ' work · ' + fmtTok(it.totals.tokens) + ' output tokens');
  return tags.join(' · ');
}
