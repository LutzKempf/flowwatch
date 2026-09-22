// The operator's clicks, checkboxes, keys and opened groups, answered in one place for the whole page. Every control
// is drawn as HTML, so it carries its intent in a data- attribute, and these listeners on the document read it.
import { select } from './board.js';
import { cleanupIds, cleanupNow } from './cleanup.js';
import {
  confirmSort,
  setCategory,
  toggleCleanup,
  toggleFilter,
  toggleFocus,
  toggleHidden,
  undoLast,
} from './sorting.js';
import { MENUS, triageOpen, ui } from './state.js';
import { renderInbox } from './toolbar.js';

document.addEventListener('click', (e) => {
  // A click that re-rendered the list leaves its target detached; it cannot be read for intent.
  if (e.target.isConnected) for (const d of document.querySelectorAll(MENUS)) if (!d.contains(e.target)) d.open = false;
  // A row selects its session; its title is a link to the app and stays one.
  const lane = e.target.closest('#lanes .lane');
  if (lane) {
    if (!e.target.closest('a')) select(lane.dataset.row);
    return;
  }
  // Switching view keeps the offer to undo: the change is still the last thing the operator did,
  // and the usual move is to sort a row, look at High focus, and think better of it.
  const view = e.target.closest('[data-view]');
  if (view) {
    // Picks belong to one visit to Cleanup: coming back never finds boxes ticked for items since changed.
    if (view.dataset.view !== ui.triageView) {
      ui.cleanupPicked = new Set();
      ui.handoffOpen = false;
      ui.handoffMsgOpen = false;
    }
    ui.triageView = view.dataset.view;
    renderInbox({ focus: '[data-view="' + CSS.escape(ui.triageView) + '"]' });
    return;
  }
  if (e.target.closest('[data-close-picked]')) {
    ui.handoffOpen = true;
    renderInbox({ focus: '[data-handoff-start] | [data-handoff-cancel]' });
    return;
  }
  if (e.target.closest('[data-handoff-cancel]')) {
    ui.handoffOpen = false;
    renderInbox({ focus: '[data-close-picked]' });
    return;
  }
  if (e.target.closest('[data-filter-all]')) {
    ui.catFilter = new Set();
    ui.lastChange = null;
    renderInbox({ focus: '[data-filter-all]' });
    return;
  }
  const filter = e.target.closest('[data-filter]');
  if (filter) {
    toggleFilter(filter.dataset.filter);
    return;
  }
  const focusBtn = e.target.closest('[data-focus]');
  if (focusBtn) {
    toggleFocus(focusBtn.dataset.focus);
    return;
  }
  const cleanBtn = e.target.closest('[data-cleanup]');
  if (cleanBtn) {
    toggleCleanup(cleanBtn.dataset.cleanup);
    return;
  }
  const catBtn = e.target.closest('[data-setcat]');
  if (catBtn) {
    setCategory(catBtn.dataset.setcat, catBtn.dataset.cat);
    return;
  }
  const keep = e.target.closest('[data-confirm]');
  if (keep) {
    confirmSort(keep.dataset.confirm);
    return;
  }
  if (e.target.closest('[data-undo]')) undoLast();
});

document.addEventListener('change', (e) => {
  const show = e.target.closest('[data-showcat]');
  if (show) {
    toggleHidden(show.dataset.showcat, show.checked);
    return;
  }
  const pick = e.target.closest('[data-pick]');
  if (pick) {
    if (pick.checked) ui.cleanupPicked.add(pick.dataset.pick);
    else ui.cleanupPicked.delete(pick.dataset.pick);
    renderInbox({ focus: '[data-pick="' + CSS.escape(pick.dataset.pick) + '"]' });
    return;
  }
  const all = e.target.closest('[data-pick-all]');
  if (all) {
    ui.cleanupPicked = all.checked ? new Set(cleanupIds(cleanupNow())) : new Set();
    renderInbox({ focus: '[data-pick-all]' });
  }
});

document.addEventListener('keydown', (e) => {
  // A board row is a button for the keyboard too; a key on its title link is the link's.
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('#lanes .lane')) {
    e.preventDefault();
    select(e.target.dataset.row);
    return;
  }
  if (e.key !== 'Escape') return;
  const d = e.target.closest('details.tr-cat, details.tr-catmenu');
  if (d && d.open) {
    d.open = false;
    d.querySelector('summary').focus();
  }
});

// Keep a group the operator closed closed, across every refresh; one category menu open at a time.
document.addEventListener(
  'toggle',
  (e) => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement)) return;
    if (d.dataset.group) {
      if (d.open) triageOpen.add(d.dataset.group);
      else triageOpen.delete(d.dataset.group);
    }
    if (d.matches('details.tr-firstmsg')) ui.handoffMsgOpen = d.open;
    if (d.matches('details.tr-cat, details.tr-catmenu') && d.open) {
      for (const other of document.querySelectorAll(MENUS)) if (other !== d) other.open = false;
    }
  },
  true
);
