// The board's rows: every open conversation with the sorting the operator gave it, how a row is known and
// grouped, its lane, and which rows the current view shows.
import { STATE_MAP } from './format.js';
import { hiddenCats, triageSorting, ui } from './state.js';

// Every open conversation, waiting or not, each with the sorting it was given and its index in window.SESS
// (si, -1 when the board has no current telemetry for it).
export function currentRows() {
  const L = window.LANES;
  const pairs = Triage.boardItems({
    inbox: (window.INBOX && window.INBOX.items) || [],
    sessions: window.SESS,
    titles: L ? L.titles || {} : null,
    now: Data.now(),
  });
  const rows = Triage.rowsFrom(
    pairs.map((p) => p.item),
    triageSorting
  );
  rows.forEach((r, i) => {
    r.si = pairs[i].si;
  });
  return rows;
}
// A row is known by its sorting key, the app session id: a new message from it is the same row.
export const rowKey = (r) => Triage.sortingKeyOf(r.item);
export const rowByKey = (key) => currentRows().find((r) => rowKey(r) === key);
// The endpoint says null for "no category", a hand-set "no category" says '': one key for both.
export const catKey = (r) => r.category || '';
// The repo's categories, from its MISSION.md, as the inbox payload carries them; none until it loads.
export const repoCategories = () => (window.INBOX && window.INBOX.categories) || [];

// A row's lane: its board session's telemetry, or for a session the board has no current events for, a
// quiet lane that shows its phase only where the board recorded it for that very session.
export function laneOf(r) {
  if (r.si >= 0) return window.SESS[r.si];
  const it = r.item;
  return {
    id: 'app:' + (it.session_id || it.key),
    cur: it.phase_from === 'board' && it.phase ? it.phase : 0,
    state: STATE_MAP[it.state] || 'waityou',
    stale: true,
    backfill: false,
    quiet: true,
  };
}

// Hidden categories and sessions sent to Cleanup leave the board; a pick narrows it to what the operator
// is looking at now. Each is undone in one click, and the header says how many sessions they keep off it.
export function shownRows(rows) {
  const picked = Triage.pickFor(ui.catFilter, hiddenCats);
  return rows.filter((r) => !r.cleanup && !hiddenCats.has(catKey(r)) && picked(catKey(r)));
}
