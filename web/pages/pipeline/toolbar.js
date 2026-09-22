// The toolbar over the board: the waiting count, the views, the category filter and menu, the caption and the
// undo line. It sets the Sessions badge in the sidebar from the same inbox it draws.
import { renderPipeline } from './board.js';
import { cleanupBody, cleanupNow } from './cleanup.js';
import { NO_CATEGORY } from './format.js';
import { catKey, currentRows, repoCategories, shownRows } from './rows.js';
import { hiddenCats, ui } from './state.js';

// The toolbar over the board (or, in Cleanup, over its list), then the board and the side panel. The
// toolbar is only rewritten when what it says changed, so a 2 s redraw never takes a button from under
// the keyboard.
let toolbarHtml = '';
export function renderInbox(opts) {
  const box = document.getElementById('triage');
  if (!box) return;
  const data = window.INBOX;
  const rows = currentRows();
  const shown = shownRows(rows);
  const clean = cleanupNow();
  let html;
  if (!data) {
    html = '<div class="inbox-h"><b>🙋 waiting on you</b><span class="tr-count">loading…</span></div>';
  } else {
    // A source the endpoint could not read is said out loud: an empty list must never be mistaken
    // for "nothing is waiting on you". An app records folder that is not there at all (Linux, or moved) gets
    // its own plain line instead: the board then runs on the hooks alone, which is a setup, not a fault.
    const recordsLine = Triage.recordsNote(data);
    const names = { app_records: 'the app’s session records', transcripts: 'the session transcripts' };
    const blind = Object.keys(data.sources || {})
      .filter((k) => data.sources[k] !== 'ok' && !(k === 'app_records' && recordsLine))
      .map((k) => names[k] || k);
    const warn =
      (recordsLine ? '<p class="tr-caption">' + escapeHtml(recordsLine) + '</p>' : '') +
      (blind.length
        ? '<p class="tr-warn">Cannot read ' +
          escapeHtml(blind.join(' and ')) +
          ' — the waiting count is not the whole picture.</p>'
        : '');
    const recheck = shown.filter((r) => r.newSinceSorted).length;
    const inHidden = rows.filter((r) => hiddenCats.has(catKey(r))).length;
    const sent = rows.filter((r) => r.cleanup && !hiddenCats.has(catKey(r))).length;
    html =
      '<div class="inbox-h"><b>🙋 <span id="waiting-n">' +
      data.items.length +
      '</span> waiting on you</b><span class="tr-count">' +
      shown.length +
      ' of ' +
      rows.length +
      ' sessions shown' +
      (inHidden ? ' · ' + inHidden + ' in hidden categories' : '') +
      (sent ? ' · ' + sent + ' sent to Cleanup' : '') +
      (recheck ? ' · ' + recheck + ' with a new message since you sorted' : '') +
      ' · as of ' +
      new Date(data.generated_at).toLocaleTimeString() +
      '</span></div>' +
      '<div class="tr-modes" role="group" aria-label="Triage view">' +
      viewButtons(shown, clean) +
      categoriesMenu(rows) +
      '</div>' +
      (ui.triageView === 'cleanup' ? '' : filterRow(rows)) +
      '<p class="tr-caption" id="triage-caption">' +
      escapeHtml(viewHint(rows)) +
      '</p>' +
      warn +
      '<div class="tr-status" aria-live="polite"></div>' +
      (ui.triageView === 'cleanup' ? cleanupBody(clean) : '');
    Nav.setBadge('sessions', Nav.waitingBadge(data)); // the same payload this panel just drew
  }
  if (opts || html !== toolbarHtml) {
    box.innerHTML = html;
    toolbarHtml = html;
  }
  renderPipeline();
  if (!opts) return;
  if (opts.keepCatMenu) {
    const menu = box.querySelector('details.tr-catmenu');
    if (menu) menu.open = true;
  }
  // Filled just after the live region exists, so a screen reader announces it; a timer rather than
  // an animation frame, which never fires while the tab is hidden.
  setTimeout(() => {
    const status = box.querySelector('.tr-status');
    if (status && ui.lastChange)
      status.innerHTML = escapeHtml(ui.lastChange.text) + '<button type="button" data-undo>Undo</button>';
    else if (status && opts.note) status.textContent = opts.note;
    // The first of the given places that is on screen: a control in a hidden view cannot take focus.
    const target =
      opts.focus &&
      opts.focus
        .split(/\s*\|\s*/)
        .map((sel) => document.querySelector(sel))
        .find((el) => el && el.offsetParent !== null);
    if (target) target.focus();
  }, 30);
}

function filterRow(rows) {
  // A chip counts what picking it shows: a session sent to Cleanup is off the board, so not counted here.
  const count = (cat) => rows.filter((r) => !r.cleanup && catKey(r) === cat).length;
  const cats = [...repoCategories(), '']
    .filter((c) => Triage.offeredIn(c, hiddenCats))
    .map((cat) => ({ cat, n: count(cat) }))
    .filter(({ cat, n }) => n > 0 || ui.catFilter.has(cat));
  if (!cats.length) return '';
  return (
    '<div class="tr-filter" role="group" aria-label="Categories to show">' +
    '<button type="button" class="tr-chip" data-filter-all aria-pressed="' +
    (ui.catFilter.size === 0) +
    '">All</button>' +
    cats
      .map(
        ({ cat, n }) =>
          '<button type="button" class="tr-chip" data-filter="' +
          escapeHtml(cat) +
          '" aria-pressed="' +
          ui.catFilter.has(cat) +
          '">' +
          escapeHtml(cat || NO_CATEGORY) +
          ' <span class="tr-tab-count">' +
          n +
          '</span></button>'
      )
      .join('') +
    '</div>'
  );
}

function categoriesMenu(rows) {
  const items = Triage.categoriesOn(window.LANES && window.LANES.lanes, repoCategories())
    .map(
      (cat) =>
        '<label class="tr-hide-row">' +
        '<input type="checkbox" data-showcat="' +
        escapeHtml(cat) +
        '"' +
        (hiddenCats.has(cat) ? '' : ' checked') +
        '>' +
        '<span>' +
        escapeHtml(cat || NO_CATEGORY) +
        '</span>' +
        '<span class="tr-tab-count">' +
        rows.filter((r) => catKey(r) === cat).length +
        '</span></label>'
    )
    .join('');
  return (
    '<details class="tr-catmenu"><summary class="tr-chip">Categories' +
    (hiddenCats.size ? ' · ' + hiddenCats.size + ' hidden' : '') +
    ' ▾</summary>' +
    '<div class="tr-menu tr-catmenu-list"><div class="tr-menu-h">Show in the inbox</div>' +
    items +
    '<p class="tr-menu-note">Untick old or deprecated categories to keep them out of the inbox. ' +
    'Nothing is closed: the count above says how many sessions are being held back.</p></div></details>'
  );
}

function viewButtons(shown, clean) {
  const views = [
    { id: 'all', label: 'All', count: shown.length },
    { id: 'focus', label: 'High focus', count: shown.filter((r) => r.focus).length },
    { id: 'cleanup', label: 'Cleanup', count: clean.sessions.length + clean.stories.length },
  ];
  return views
    .map(
      (v) =>
        '<button type="button" data-view="' +
        v.id +
        '" aria-pressed="' +
        (v.id === ui.triageView) +
        '">' +
        escapeHtml(v.label) +
        ' <span class="tr-tab-count">' +
        v.count +
        '</span></button>'
    )
    .join('');
}

function viewHint(rows) {
  if (ui.triageView === 'cleanup')
    return hiddenCats.size || rows.some((r) => r.cleanup)
      ? 'The sessions you sent here, and the sessions and stories of your hidden categories. Tick what should be gone, then close it.'
      : 'Nothing is hidden or sent here, so everything is listed. Send a session here from its panel, or untick old categories under “Categories”.';
  const picked = ui.catFilter.size
    ? ' Showing only ' + [...ui.catFilter].map((c) => c || NO_CATEGORY).join(', ') + '.'
    : '';
  return (
    (ui.triageView === 'focus'
      ? 'Sessions you marked as needing real thought, earliest phase first.'
      : 'Every open session, grouped by what it needs from you. Select a row to sort it: High focus, category or Cleanup.') +
    picked
  );
}
