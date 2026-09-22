// The Gate pipeline panel: what the repo's gate runner is running and what waits, in its order (data: /api/gates,
// the repo's gates feed; read-only). It also sets the panel's sidebar badge from the same answer.
import { IN_APP, displayTitle } from './format.js';

export const GATE_POLL_MS = 20000;
window.GATES = null;
let gatesFetchedAt = 0; // the last successful read, by this page's clock
let gatesError = '';

function gqAge(ms) {
  const m = Math.max(0, Math.round((ms || 0) / 60000));
  if (m < 60) return m + 'm';
  if (m < 48 * 60) return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
  return Math.round(m / 1440) + 'd';
}
function gateName(g) {
  return g.branch || g.worktree;
}
// A gate belongs to a session: when the inbox has a session on the same worktree AND the same branch,
// the gate carries that session's title and opens it in the app. Otherwise its branch, then its
// worktree — never a guessed title. The worktree alone is not enough: worktrees are recycled between
// sessions, so matched on the folder alone, a running gate would take the title of an earlier session
// in it, on another branch entirely.
function gateSession(g) {
  if (!g.branch) return null;
  const items = (window.INBOX && window.INBOX.items) || [];
  return items.find((i) => i.session_id && i.worktree === g.worktree && i.branch === g.branch) || null;
}
function gateTitleHtml(g) {
  const s = gateSession(g);
  return IN_APP && s
    ? '<a href="claude://code/continue?session=' +
        encodeURIComponent(s.session_id) +
        '" title="opens this session in the Claude app">' +
        escapeHtml(displayTitle(s)) +
        '</a>'
    : escapeHtml(s ? displayTitle(s) : gateName(g));
}
// Two minutes without a successful read and the panel says how old it is.
const GATE_STALE_MS = 2 * 60000;

// The scheduler's own reason, in words: "concurrency cap reached (1 of 1 in active mode)".
function gateWhy(s) {
  const blocked = (s && s.blocked) || '';
  const m = blocked.match(/concurrency cap reached \((\d+) of (\d+) in (\w+) mode\)/);
  if (m) {
    const when = m[3] === 'active' ? 'while you are using the computer' : 'while the box is idle';
    return m[1] + ' running, ' + m[2] + ' allowed at a time ' + when + '. The next gate starts when one finishes.';
  }
  return blocked ? 'Nothing new starts right now: ' + blocked + '.' : '';
}

// A running gate writes its step results only near the end, so progress is time against how long
// gates have actually taken here — never a step count, which would be a previous run's.
function gateRunRow(r, H, now) {
  const ranMs = now - r.granted_at,
    ranMin = ranMs / 60000;
  let bar = '';
  if (H) {
    const late = ranMin > H.p90;
    const pct = Math.min(100, Math.round((100 * ranMin) / H.median));
    bar =
      '<div class="gq-bar' +
      (late ? ' late' : '') +
      '" role="img" aria-label="running ' +
      Math.round(ranMin) +
      ' of a typical ' +
      H.median +
      ' minutes"><span style="width:' +
      pct +
      '%"></span></div>' +
      '<div class="gq-sub">' +
      (late
        ? 'taking longer than usual: 9 in 10 gates finish within ' + H.p90 + ' min'
        : 'gates usually take ' + H.p25 + '–' + H.p75 + ' min') +
      '</div>';
  }
  const sub = [
    gateSession(r) ? gateName(r) : null,
    r.mode ? r.mode + ' mode' : null,
    r.cores ? r.cores + ' core' + (r.cores === 1 ? '' : 's') : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    '<div class="gq-run"><div class="gq-row"><div class="gq-title">' +
    gateTitleHtml(r) +
    '</div><span class="gq-time">running ' +
    gqAge(ranMs) +
    '</span></div>' +
    (sub ? '<div class="gq-sub">' + escapeHtml(sub) + '</div>' : '') +
    bar +
    '</div>'
  );
}

function renderGates() {
  const box = document.getElementById('gates');
  if (!box) return;
  const Q = window.GATES;
  Nav.setBadge('gates', Nav.gateBadge(Q)); // the same queue this panel draws, kept on a failed refresh like the panel
  const now = Data.now();
  // Old data says how old it is: a collector that stopped answering must not leave a confident queue.
  const stale =
    gatesFetchedAt && now - gatesFetchedAt > GATE_STALE_MS
      ? ' · <span class="gq-stale">not updated for ' + gqAge(now - gatesFetchedAt) + '</span>'
      : '';
  const head = (meta) =>
    '<div class="gq-h"><b>Gate queue</b><span class="gq-meta mono">' + meta + stale + '</span></div>';
  const fetchNote = gatesError
    ? '<p class="gq-fetch-error" role="status">Cannot reach the collector (' +
      escapeHtml(gatesError) +
      ')' +
      (Q ? '. Showing the last queue that loaded.' : '.') +
      '</p>'
    : '';
  if (!Q) {
    box.innerHTML = head(gatesError ? '' : 'loading') + fetchNote;
    return;
  }
  // Not set up, off or unreadable is said out loud, as on every panel: it must never look like a quiet box.
  if (Q.state !== 'data') {
    box.innerHTML =
      head(Q.state === 'off' ? 'off' : Q.state === 'error' ? 'unavailable' : 'not set up') +
      fetchNote +
      panelNote(Q, GATES_WHAT, feedAgent('gates'));
    return;
  }
  const S = Q.scheduler,
    H = Q.history;
  // A scheduler that stopped ticking starts nothing, and the queue under it looks perfectly normal. A feed
  // with no scheduler says nothing about one.
  const tick = !S
    ? ''
    : S.tick_age_ms == null
      ? 'the scheduler has never ticked'
      : 'last scheduler tick ' +
        (S.tick_age_ms < 60000 ? Math.round(S.tick_age_ms / 1000) + 's' : gqAge(S.tick_age_ms)) +
        ' ago';
  const why =
    S && S.stalled
      ? '<p class="gq-fetch-error">The scheduler has stopped: ' +
        tick +
        '. Nothing will start until it ticks again.</p>'
      : gateWhy(S)
        ? '<p class="gq-why">' + escapeHtml(gateWhy(S)) + '</p>'
        : '';
  const running =
    Q.running.map((r) => gateRunRow(r, H, now)).join('') || '<div class="gq-empty">Nothing running.</div>';
  const waiting = Q.waiting
    .map(
      (w) =>
        '<li class="gq-item" data-wt="' +
        escapeHtml(w.worktree) +
        '"><span class="gq-pos">' +
        w.position +
        '</span><div><div class="gq-title">' +
        gateTitleHtml(w) +
        '</div>' +
        (gateSession(w) ? '<div class="gq-sub">' + escapeHtml(gateName(w)) + '</div>' : '') +
        '</div><span class="gq-time">waiting ' +
        gqAge(w.queued_since != null ? now - w.queued_since : w.waited_ms) +
        '</span></li>'
    )
    .join('');
  box.innerHTML =
    head(Q.running.length + ' running · ' + Q.waiting.length + ' waiting') +
    fetchNote +
    why +
    '<div class="gq-sec">Running</div>' +
    running +
    (H
      ? '<p class="gq-basis">Typical times from ' + H.runs + ' passed gates in the last ' + H.window_days + ' days.</p>'
      : '<p class="gq-basis">Too few passed gates in the last 14 days to say how long one usually takes.</p>') +
    '<div class="gq-sec">Waiting <span>in the order the scheduler starts them</span></div>' +
    (waiting ? '<ol class="gq-list">' + waiting + '</ol>' : '<div class="gq-empty">Nobody is waiting.</div>') +
    '<p class="gq-note">' +
    (tick ? escapeHtml(tick) + '. ' : '') +
    "Read-only: the order is the scheduler's own.</p>";
}

export async function tickGates() {
  // A failed read keeps the last good data on screen and says why it is not refreshing.
  try {
    const r = await Data.get('gates');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    window.GATES = await r.json();
    gatesFetchedAt = Data.now();
    gatesError = '';
  } catch (e) {
    gatesError = (e && e.message) || 'network error';
  }
  renderGates();
}
