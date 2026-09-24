// The page's polls of the pipeline, the inbox, the lanes and the setup list. Each keeps what is on screen when a
// read fails, and redraws only on real news.
import { renderPipeline } from './board.js';
import { STATE_MAP, tokCell } from './format.js';
import { renderHistory } from './rollup.js';
import { MENUS } from './state.js';
import { renderInbox } from './toolbar.js';

window.SESS = [];
window.AGG = [];
window.INBOX = null;

let inboxSig = ''; // what is drawn, so a poll only redraws on real news

export async function tick() {
  // try/catch: a collector restart must show the offline badge, keep the last
  // rendered board, and never leave an unhandled rejection in the console.
  try {
    const data = await Data.get('pipeline').then((r) => r.json());
    // window_days: the server-side session age window (0 = full history). Surfaced
    // in the sessions tile so a filtered board never looks like the whole picture.
    window.WINDOW_DAYS = data.window_days;
    // Two filters, deliberately both: the window decides what the server sends at
    // all, and archiving hides what is still sent but no longer current. Archived
    // sessions are dropped HERE, at the source: the tiles, the rollup and the detail
    // panel all read window.SESS. Their rollup is not lost — the server precomputes
    // it into data.history.
    window.SESS = data.sessions
      .filter((s) => !s.archived)
      .map((s) => ({
        id: s.id,
        wt: s.worktree,
        ms: s.milestone,
        cur: s.current_phase,
        state: STATE_MAP[s.state] || 'work',
        stale: s.stale, // an ATTRIBUTE of the lane, never its state
        seen: s.last_seen, // orders the waiting banner, freshest first
        backfill: s.origin === 'backfill', // badged: a backfilled session's data is partial
        p: s.phases.map((ph) => ({
          w: Math.round(ph.work_ms / 60000),
          u: Math.round(ph.wait_ms / 60000),
          t: tokCell(ph.tokens_usd, ph.tokens),
          usd: ph.tokens_usd,
          tok: ph.tokens,
          i: ph.inputs,
        })),
      }));
    window.AGG = data.aggregate; // cross-session rollup (server-scored)
    window.HISTORY = data.history; // archived-session rollup (kept, not discarded)
    redraw();
    renderHistory(window.HISTORY);
    setConnStatus(false);
  } catch {
    setConnStatus(true);
  } // DOM keeps last data
}

// Redraw after a poll: the whole panel, unless the operator has a menu open (the side panel then keeps
// its own, and the toolbar waits for a later poll).
function redraw() {
  if (document.querySelector(MENUS)) renderPipeline();
  else renderInbox();
}

// The page polls every 2 s, but a redraw under the operator's hands closes their menu and drops
// their focus. So it redraws only when the inbox actually changed, and never mid-choice.
const inboxSigOf = (d) =>
  !d
    ? ''
    : d.generated_at && d.items
      ? d.items.map((i) => i.key + '|' + i.state + '|' + i.hours_waiting + '|' + i.phase).join(',') +
        '|' +
        JSON.stringify(d.sources || {})
      : '';
export async function tickInbox() {
  // Same shape as tick(): a collector restart keeps the last inbox on screen rather than blanking it.
  try {
    window.INBOX = await Data.get('inbox').then((r) => r.json());
  } catch {
    return; /* keep what is rendered */
  }
  const sig = inboxSigOf(window.INBOX);
  if (sig === inboxSig) return;
  if (document.querySelector(MENUS)) return; // the operator is choosing; redraw on a later tick
  // The signature is only advanced by a render that finished. Advancing it first would mean one
  // throw inside the render froze the inbox for good: every later tick would see "nothing new" and
  // return, leaving a stale list under a stale "as of" time with nothing on screen saying so.
  // The board's rows and the waiting tile come from the inbox too: renderInbox redraws them in the same
  // beat, so the page never shows two counts that disagree.
  renderInbox();
  inboxSig = sig;
}

/* ---- lanes payload (data: /api/lanes): titles for the board's rows, stories for Cleanup ---- */
window.LANES = null;
let lanesSig = '';

export async function tickLanes() {
  // Same shape as the other polls: a failed read keeps what is on screen.
  try {
    const r = await Data.get('lanes');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    window.LANES = await r.json();
  } catch {
    return;
  }
  // Redraw only on real news: titles and categories name and filter the board's rows; stories and the
  // skill's presence feed Cleanup.
  const L = window.LANES;
  const sig = JSON.stringify([
    L.titles,
    (L.lanes || []).map((l) => [
      l.name,
      (l.stories || []).map((c) => [c.topic, c.days_since_touched]),
      (l.older || []).map((c) => c.topic),
    ]),
    L.cleanup_skill,
  ]);
  if (sig === lanesSig) return;
  redraw();
  lanesSig = sig;
}

// The setup banner, and panels turned off leaving the sidebar (render.js). An outage is tick()'s to say.
export async function loadSetup() {
  try {
    const r = await Data.get('setup');
    if (r.ok) {
      renderSetup(await r.json());
      redraw();
    }
  } catch {
    /* tick() reports it */
  }
}
