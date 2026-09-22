// What the operator's sorting controls do: High focus, Cleanup, a category, "Still right", the category filter
// and hiding a category. Each change to a session is remembered so Undo can reverse it.
import { prunePicks } from './cleanup.js';
import { NO_CATEGORY, displayTitle } from './format.js';
import { catKey, currentRows, rowByKey } from './rows.js';
import { closeMenus, hiddenCats, restoreSnapshot, saveHidden, saveSorting, snapshotOf, ui } from './state.js';
import { renderInbox } from './toolbar.js';

export function toggleFocus(key) {
  const row = rowByKey(key);
  if (!row) return;
  const title = displayTitle(row.item),
    before = snapshotOf(row.item);
  saveSorting(row.item, { focus: !row.focus });
  ui.lastChange = {
    item: row.item,
    title,
    before,
    text: (row.focus ? 'Took ' : 'Added ') + '“' + title + '” ' + (row.focus ? 'out of' : 'to') + ' High focus.',
  };
  renderInbox({ focus: '#detail [data-focus]' });
}

// Sent to Cleanup, a session leaves the board and is listed under Cleanup, whatever its category.
export function toggleCleanup(key) {
  const row = rowByKey(key);
  if (!row) return;
  const title = displayTitle(row.item),
    before = snapshotOf(row.item);
  saveSorting(row.item, { cleanup: !row.cleanup });
  prunePicks();
  ui.lastChange = {
    item: row.item,
    title,
    before,
    text: row.cleanup
      ? 'Put “' + title + '” back on the board.'
      : 'Sent “' + title + '” to Cleanup: it has left the board.',
  };
  renderInbox({ focus: '#detail [data-cleanup] | [data-undo]' });
}

// value: a category, '' for no category, or '__auto' to go back to the one the endpoint reports.
export function setCategory(key, value) {
  const row = rowByKey(key);
  if (!row) return;
  const title = displayTitle(row.item),
    before = snapshotOf(row.item),
    auto = row.item.category || '';
  // Only the "back to automatic" button goes back. Picking the category the endpoint already
  // guessed pins it: otherwise clicking "No category" on a session the endpoint has no category
  // for does nothing at all, and the endpoint can later infer one over the operator's own answer.
  const backToAuto = value === '__auto';
  saveSorting(row.item, { category: backToAuto ? undefined : value });
  const now = backToAuto ? auto : value;
  ui.lastChange = {
    item: row.item,
    title,
    before,
    text: '“' + title + '” ' + (now ? 'is now in ' + now + '.' : 'now has no category.'),
  };
  closeMenus();
  renderInbox({ focus: '#detail details.tr-cat > summary' });
}

// "Still right": the session said something new, and the sorting it was given still holds.
export function confirmSort(key) {
  const row = rowByKey(key);
  if (!row || !row.newSinceSorted) return;
  const title = displayTitle(row.item),
    before = snapshotOf(row.item);
  saveSorting(row.item, {});
  ui.lastChange = { item: row.item, title, before, text: 'Kept the sorting of “' + title + '”.' };
  renderInbox({ focus: '#detail [data-focus]' });
}

export function undoLast() {
  if (!ui.lastChange) return;
  const change = ui.lastChange;
  ui.lastChange = null;
  restoreSnapshot(change.item, change.before);
  prunePicks();
  renderInbox({ note: 'Undid the last change to “' + change.title + '”.', focus: '#detail [data-focus]' });
}

export function toggleFilter(cat) {
  if (ui.catFilter.has(cat)) ui.catFilter.delete(cat);
  else ui.catFilter.add(cat);
  ui.lastChange = null;
  renderInbox({ focus: '[data-filter="' + CSS.escape(cat) + '"]' });
}

// Showing or hiding a category is its own undo: tick the box again.
export function toggleHidden(cat, show) {
  if (show) hiddenCats.delete(cat);
  else hiddenCats.add(cat);
  ui.catFilter = Triage.dropUnofferedPicks(ui.catFilter, hiddenCats);
  prunePicks();
  saveHidden();
  ui.lastChange = null;
  const name = cat || NO_CATEGORY,
    n = currentRows().filter((r) => !r.cleanup && catKey(r) === cat).length; // the rows that left or joined the board
  renderInbox({
    keepCatMenu: true,
    focus: '[data-showcat="' + CSS.escape(cat) + '"]',
    note: show
      ? name + ' is shown again.'
      : name + ' is hidden: ' + n + ' session' + (n === 1 ? '' : 's') + ' left the board.',
  });
}
