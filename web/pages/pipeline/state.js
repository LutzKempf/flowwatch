// What the page holds for the operator between redraws: their sorting and hidden categories (kept in this browser),
// the view and picks of the moment, which groups are open, and which menus a redraw must leave alone.

// Which groups are open survives the 2 s re-render; High focus opens its view, the rest of that view starts closed.
export const triageOpen = new Set([
  ...Triage.BOARD_GROUPS.filter((g) => g.open).map((g) => g.id),
  'focus',
  'clean-sessions',
  'clean-stories',
]);

/* The operator's own sorting. It lives in this browser: the endpoint reports facts, and which
   sessions need real thought is a judgement no session record carries. */
const SORTING_KEY = 'flowwatch-triage-sorting';
// Keys used under the dashboard's earlier name, read once so a browser keeps the sorting it had.
const OLD_KEY = {
  'flowwatch-triage-sorting': 'mission-control-triage-sorting',
  'flowwatch-hidden-categories': 'mission-control-hidden-categories',
};
const stored = (k) => localStorage.getItem(k) || localStorage.getItem(OLD_KEY[k]);

const readStore = (k) => {
  try {
    const v = JSON.parse(stored(k) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};
const writeStore = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage blocked: the sorting lasts until this page is reloaded */
  }
};
const HIDDEN_KEY = 'flowwatch-hidden-categories';
const readList = (k) => {
  try {
    const v = JSON.parse(stored(k) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
export const saveHidden = () => {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hiddenCats]));
  } catch {
    /* storage blocked: lasts until this page is reloaded */
  }
};

export let triageSorting = readStore(SORTING_KEY); // session id -> {focus?, category?, sortedKey, at}
export const hiddenCats = new Set(readList(HIDDEN_KEY)); // categories kept out of the inbox for good
// The operator's choices of the moment. Several modules change them, and an imported binding cannot be assigned,
// so they are one shared object.
export const ui = {
  catFilter: new Set(), // categories picked to look at now; empty = all of them
  triageView: 'all', // 'all', 'focus' or 'cleanup'
  lastChange: null, // the one change Undo reverses
  cleanupPicked: new Set(), // Cleanup picks: 's:'+session sorting key, 'c:'+story topic
  handoffOpen: false, // the hand-off panel is showing
  handoffMsgOpen: false, // its "First message it gets" is open, across redraws
};

export function saveSorting(item, changes) {
  triageSorting = Triage.applySorting(triageSorting, item, changes, new Date(Data.now()).toISOString());
  writeStore(SORTING_KEY, triageSorting);
}
export const snapshotOf = (item) => {
  const p = triageSorting[Triage.sortingKeyOf(item)];
  return p ? JSON.parse(JSON.stringify(p)) : null;
};
export function restoreSnapshot(item, pick) {
  const next = { ...triageSorting },
    k = Triage.sortingKeyOf(item);
  if (pick) next[k] = pick;
  else delete next[k];
  triageSorting = next;
  writeStore(SORTING_KEY, triageSorting);
}

export const MENUS = 'details.tr-cat[open], details.tr-catmenu[open]';

// A menu is closed before the page redraws: the side panel is never redrawn under an open one.
export const closeMenus = () => {
  for (const d of document.querySelectorAll(MENUS)) d.open = false;
};
