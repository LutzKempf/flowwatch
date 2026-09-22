// The Sessions board: the four tiles, the line of what is left off, the rows by group with their twelve phase
// cells, and which row is selected. Redrawn after every poll without taking the keyboard from the operator.
import { renderDetail } from './detail.js';
import { IN_APP, NO_CATEGORY, PHASES, displayTitle, stateLabel, tile } from './format.js';
import { renderRollup } from './rollup.js';
import { catKey, currentRows, laneOf, rowByKey, rowKey, shownRows } from './rows.js';
import { closeMenus, hiddenCats, triageOpen, ui } from './state.js';

let SELKEY = null; // the selected row, by its sorting key: it survives the session saying something new

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

/* ---- phase header (static, built once) ---- */
const phhead = document.getElementById('phhead');
phhead.appendChild(el('div', '', ''));
PHASES.forEach((p, i) => phhead.appendChild(el('div', 'ph', '<b>' + (i + 1) + '</b>' + p[0])));

export function renderPipeline() {
  const SESS = window.SESS,
    L = window.LANES;

  /* ---- the board's rows: every open conversation (Triage.boardItems) ---- */
  // Telemetry alone misses open sessions: many sessions waiting on the operator are either never on the
  // board (no pipeline events at all) or archived there after 7 quiet days. So a row is an open conversation: each inbox session, plus each board conversation with an
  // app record (its earlier parts folded in, /api/lanes) the inbox has no record for. An inbox session
  // with no current telemetry shows its phase only when the board recorded it for that very session.
  const rows = currentRows();
  const shown = shownRows(rows);

  /* ---- tiles ---- */
  let work = 0,
    uwait = 0,
    inputs = 0,
    waiting = 0;
  SESS.forEach((s) => {
    s.p.forEach((d) => {
      work += d.w;
      uwait += d.u;
      inputs += d.i;
    });
    if (s.state === 'waityou') waiting++;
  });
  // Every count on the page agrees: the sessions tile counts the board's rows, and waiting-on-you is the
  // inbox's own count once the inbox has loaded. Work, inputs and the split are what telemetry recorded.
  if (window.INBOX) waiting = window.INBOX.items.length;
  // Absent is not zero. With no measured time at all, "0% / 100%" reads as
  // "the agent did nothing and you waited the whole time" — a claim, from no data.
  const measured = work + uwait;
  const pctW = measured ? Math.round((100 * work) / measured) : null;
  const splitTxt = pctW == null ? '—' : pctW + '% / ' + (100 - pctW) + '%';
  document.getElementById('tiles').innerHTML =
    // Counts every open session; the caption says how many of them the board shows, once any are hidden or sent to Cleanup.
    tile(
      rows.length,
      'open sessions',
      shown.length === rows.length ? 'the rows of the board below' : shown.length + ' of them on the board below',
      'var(--ink)'
    ) +
    tile(waiting, 'waiting on YOU now', 'blocked - your call unblocks them', 'var(--violet)') +
    tile(inputs, 'inputs from you', 'times a session paused for you (recorded)', 'var(--amber)') +
    tile(
      splitTxt,
      'agent-work / you-wait',
      measured ? 'of wall-clock time in-pipeline (recorded)' : 'no time measured yet',
      'var(--cyan)'
    );

  /* ---- the board, grouped the way the inbox was ---- */
  // In the Cleanup view the list above takes the board's place.
  document.getElementById('board').hidden = ui.triageView === 'cleanup';
  const count = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const notes = [];
  if (!L)
    notes.push('session titles have not loaded: board sessions show under their folder, and one may repeat a row');
  const hiddenN = rows.filter((r) => hiddenCats.has(catKey(r))).length;
  if (hiddenN) notes.push('not shown: ' + count(hiddenN, 'session', 'sessions') + ' in hidden categories');
  const sentN = rows.filter((r) => r.cleanup && !hiddenCats.has(catKey(r))).length;
  if (sentN) notes.push('not shown: ' + count(sentN, 'session', 'sessions') + ' you sent to Cleanup');
  if (L && L.earlier_parts)
    notes.push(
      count(L.earlier_parts, 'earlier part', 'earlier parts') + ' of continued conversations folded into their row'
    );
  // Closed in the app, still on the board until it has been quiet for 7 days (Triage.boardItems).
  const archivedN = L
    ? SESS.filter((s) => {
        const t = L.titles && L.titles[s.id];
        return t && t.app_archived;
      }).length
    : 0;
  if (archivedN) notes.push('not shown: ' + count(archivedN, 'session', 'sessions') + ' archived in the app');
  // Not checked per session, hence "usually": the ones looked at had no transcript at all.
  if (L && L.without_app_record)
    notes.push(
      'not shown: ' +
        count(L.without_app_record, 'session', 'sessions') +
        ' with no Claude app record (usually empty starts with no conversation)'
    );
  const quiet = shown.filter((r) => r.si < 0).length;
  if (quiet)
    notes.push(
      count(quiet, 'row has', 'rows have') +
        ' no recent pipeline events: dimmed, phase shown only where it was recorded'
    );
  document.getElementById('board-sum').textContent = notes.join(' · ');
  const lanesEl = document.getElementById('lanes');
  // The rows are final once both the titles and the inbox have loaded.
  lanesEl.dataset.titles = L && window.INBOX ? 'loaded' : 'pending';
  const groups = boardGroups(shown);
  // A redraw must not take the keyboard away from the row the operator is on.
  const was = document.activeElement,
    onLane = was && was.closest ? was.closest('#lanes .lane') : null;
  const onKey = onLane && onLane.dataset.row,
    onLink = !!onLane && was.tagName === 'A';
  // An empty board is a legitimate state, not a failure: every session may be archived, or hidden. Say
  // which — a blank panel reads as "broken".
  // A repo where no session has ever reported says so, and whether tracking is installed.
  const S = window.SETUP,
    hooks = S && S.items && S.items.find((i) => i.id === 'hooks');
  const neverReported = S && !S.lastEventAt;
  lanesEl.innerHTML = groups.length
    ? groups.map(groupHtml).join('')
    : '<div class="empty">' +
      (rows.length
        ? '<b>No session to show.</b> The line above says which open sessions are left out and why.'
        : neverReported && hooks && hooks.state === 'ok'
          ? '<b>No session has reported yet.</b> Session tracking is installed: start a Claude Code session in this repo and it shows here.'
          : neverReported
            ? '<b>No session has reported yet.</b> Session tracking is not installed in this repo: ask your agent to follow ' +
              'the Flowwatch SETUP.md, step 5 “Session tracking”.'
            : '<b>No sessions open right now.</b> A session shows here while it is open in the app or recording ' +
              'pipeline events. Archived work is summarised below.') +
      '</div>';
  if (onKey) {
    const again = lanesEl.querySelector('.lane[data-row="' + CSS.escape(onKey) + '"]');
    const target = again && ((onLink && again.querySelector('a')) || again);
    if (target) target.focus({ preventScroll: true });
  }

  renderRollup();

  /* ---- keep / restore selection: until the operator picks one, the first row of the first open group ---- */
  // Chosen only once the rows are final: picked earlier, it lands on a working session before the
  // sessions waiting on the operator have arrived.
  if (!rows.some((r) => rowKey(r) === SELKEY) && lanesEl.dataset.titles === 'loaded') {
    const first = groups.find((g) => triageOpen.has(g.id) && g.list.length);
    SELKEY = first ? rowKey(first.list[0]) : null;
  }
  select(SELKEY);
}

/* ---- the selected session (opened by selecting a board row) ---- */
export function select(key) {
  // Another row, however it was chosen (a click, Enter), closes the menu held open for the previous one,
  // so the side panel follows the selection instead of keeping the last session under an open menu.
  if (key !== SELKEY) closeMenus();
  SELKEY = key;
  document.querySelectorAll('#lanes .lane').forEach((l) => l.classList.toggle('sel', l.dataset.row === key));
  // Never redrawn under the operator's hands: a redraw would close the category menu they have open.
  if (document.querySelector('#detail details.tr-cat[open]')) return;
  renderDetail(key ? rowByKey(key) : null);
}

function laneHtml(r) {
  const s = laneOf(r),
    it = r.item,
    key = rowKey(r),
    name = displayTitle(it);
  // Each control does one thing: the title opens the session in the app, the rest of the row selects it.
  const titleHtml =
    IN_APP && it.session_id && !it.app_archived
      ? '<a href="claude://code/continue?session=' +
        encodeURIComponent(it.session_id) +
        '" title="' +
        escapeHtml(it.title) +
        ' — opens this session in the Claude app">' +
        escapeHtml(name) +
        '</a>'
      : '<span class="t" title="' +
        escapeHtml(it.title + (it.app_archived ? ' — archived in the app' : '')) +
        '">' +
        escapeHtml(name) +
        '</span>';
  // One line per row: the status the cells already show by colour moves to a hover tooltip.
  const tip =
    (s.cur ? 'phase ' + s.cur : 'no phase recorded') +
    ' · ' +
    (stateLabel[s.state] || s.state) +
    (s.stale ? ' · stale' : '') +
    (s.quiet ? ' · no current pipeline events' : '');
  let cells = '';
  for (let ph = 1; ph <= 12; ph++) {
    let c = 'cell',
      mk = '';
    if (ph < s.cur) {
      c += ' done';
    } else if (ph === s.cur) {
      c += ' cur ' + s.state + (s.stale ? ' stale' : '');
      mk = s.state === 'waityou' ? '🙋' : s.state === 'machwait' ? '⏳' : s.state === 'abandoned' ? '··' : '▶';
    } else {
      c += ' pending';
    }
    cells +=
      '<div class="' +
      c +
      '"><span class="num">' +
      ph +
      '</span>' +
      (mk ? '<span class="mk">' + mk + '</span>' : '') +
      '</div>';
  }
  // A group, not a button: a button's content is hidden from screen readers, and the title link inside would go with it.
  // Enter and Space still select the row (the keydown handler in events.js).
  return (
    '<div class="lane' +
    (s.quiet ? ' quiet' : '') +
    (r.stuck ? ' stuck' : '') +
    (key === SELKEY ? ' sel' : '') +
    '" tabindex="0" role="group"' +
    ' data-row="' +
    escapeHtml(key) +
    '" data-id="' +
    escapeHtml(String(s.id)) +
    '"' +
    (it.session_id ? ' data-app="' + escapeHtml(it.session_id) + '"' : '') +
    ' data-cat="' +
    escapeHtml(catKey(r)) +
    '"' +
    ' aria-label="' +
    escapeHtml('Select ' + name) +
    '">' +
    '<div class="lname" title="' +
    escapeHtml(tip) +
    '"><b>' +
    (r.focus ? '<span class="star" title="High focus">★</span>' : '') +
    '<span class="lcat">' +
    escapeHtml(r.category || NO_CATEGORY) +
    '</span>' +
    titleHtml +
    (s.backfill
      ? '<span class="chip" title="backfilled from transcript - estimates, not live-tracked">◔ partial</span>'
      : '') +
    '</b></div>' +
    cells +
    '</div>'
  );
}

// The groups the board draws: in All, the inbox's groups then "working, not waiting on you", every row
// listed; in High focus, the focused rows earliest phase first, then the rest behind a closed group.
function boardGroups(shown) {
  if (ui.triageView === 'focus')
    return [
      {
        id: 'focus',
        title: 'High focus',
        list: shown.filter((r) => r.focus).sort(Triage.byEarliestPhase),
        empty: 'Nothing in High focus yet. Select a session and press its “High focus” button.',
      },
      {
        id: 'rest',
        title: 'Not in High focus',
        list: shown.filter((r) => !r.focus).sort(Triage.byNewest),
        cls: 'tr-rest',
      },
    ].filter((g) => g.list.length || g.empty);
  const by = {};
  for (const r of shown) (by[r.bucket] = by[r.bucket] || []).push(r);
  return Triage.BOARD_GROUPS.filter((g) => by[g.id]).map((g) => ({
    id: g.id,
    title: g.title,
    list: by[g.id].sort(Triage.byNewest),
  }));
}
function groupHtml(g) {
  return (
    '<details class="tr-group' +
    (g.cls ? ' ' + g.cls : '') +
    '" data-group="' +
    g.id +
    '"' +
    (triageOpen.has(g.id) ? ' open' : '') +
    '><summary>' +
    escapeHtml(g.title) +
    ' <span>' +
    g.list.length +
    '</span></summary>' +
    (g.list.length ? g.list.map(laneHtml).join('') : '<div class="tr-empty">' + escapeHtml(g.empty) + '</div>') +
    '</details>'
  );
}
