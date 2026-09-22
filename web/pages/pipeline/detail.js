// The side panel: the selected session's title, what it last said, its sorting controls and its per-phase numbers.
import { IN_APP, NO_CATEGORY, PHASES, age, displayTitle, factTags, rbar, stateLabel, tokCell } from './format.js';
import { laneOf, repoCategories, rowKey } from './rows.js';

// The side panel shows the selected session even once it has left the board (sent to Cleanup, say), so
// the change can be seen and undone where it was made. Like the toolbar, it is only rewritten when what
// it shows changed: a 2 s poll must not take a button from under the keyboard.
let detailHtml = '';
export function renderDetail(r) {
  const $ = (id) => document.getElementById(id);
  const part = {
    name: 'No session selected',
    sub: '',
    say: '<p class="hint">Select a row on the board to sort it and see its per-phase numbers.</p>',
    sort: '',
    rows: '',
    tot: '',
    table: false,
  };
  if (r) {
    const it = r.item,
      s = laneOf(r),
      name = displayTitle(it);
    part.name =
      IN_APP && it.session_id && !it.app_archived
        ? '<a href="claude://code/continue?session=' +
          encodeURIComponent(it.session_id) +
          '" title="opens this session in the Claude app">' +
          escapeHtml(name) +
          '</a>'
        : escapeHtml(name);
    const ago = (h) => (h < 1 ? 'just now' : age(h) + ' ago');
    const when =
      it.waiting === false
        ? 'last active ' + ago(it.hours_waiting)
        : 'waiting on you · last message ' + ago(it.hours_waiting);
    part.sub =
      (s.cur
        ? 'now at <b>phase ' +
          s.cur +
          ' ' +
          PHASES[s.cur - 1][0] +
          '</b> (' +
          escapeHtml(stateLabel[s.state] || s.state) +
          ')'
        : 'no phase recorded') +
      ' · ' +
      escapeHtml(when) +
      (s.backfill ? ' <span class="chip">◔ partial</span>' : '');
    part.say =
      (it.last_ask ? '<blockquote class="tr-ask">' + escapeHtml(it.last_ask) + '</blockquote>' : '') +
      '<div class="tr-meta">' +
      escapeHtml(factTags(it)) +
      '</div>';
    part.sort = sortControls(r);
    const b = r.si >= 0 ? window.SESS[r.si] : null;
    if (!b) part.tot = 'No per-phase record: the board has no current pipeline events for this session.';
    else {
      part.table = true;
      let tw = 0,
        tu = 0,
        tusd = 0,
        ttok = 0,
        ti = 0;
      part.rows = PHASES.map((p, i) => {
        const d = b.p[i];
        const reached = i + 1 <= b.cur;
        const cur = i + 1 === b.cur;
        if (d && reached) {
          tw += d.w;
          tu += d.u;
          tusd += d.usd;
          ttok += d.tok;
          ti += d.i;
        }
        if (!reached || !d)
          return (
            '<tr class="dimr"><td class="pname"><b>' +
            (i + 1) +
            ' ' +
            p[0] +
            '</b></td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>'
          );
        return (
          '<tr class="' +
          (cur ? 'now' : '') +
          '"><td class="pname"><b>' +
          (i + 1) +
          ' ' +
          p[0] +
          '</b></td>' +
          '<td>' +
          d.w +
          'm</td>' +
          '<td style="color:' +
          (d.u >= 15 ? 'var(--violet)' : 'inherit') +
          '">' +
          d.u +
          'm</td>' +
          '<td>' +
          d.t +
          '</td><td>' +
          rbar(d.r) +
          '</td>' +
          '<td style="color:' +
          (d.i >= 3 ? 'var(--amber)' : 'inherit') +
          '">' +
          d.i +
          '</td></tr>'
        );
      }).join('');
      const pw = tw + tu ? Math.round((100 * tw) / (tw + tu)) : 0;
      part.tot =
        'Session total: <b class="mono">' +
        tw +
        'm</b> work · ' +
        '<b class="mono" style="color:var(--violet)">' +
        tu +
        'm</b> your-wait · <b class="mono">' +
        tokCell(tusd, ttok) +
        '</b> tokens · ' +
        '<b class="mono">' +
        ti +
        '</b> inputs ' +
        '<span class="wl"><i class="w" style="width:' +
        pw +
        '%"></i><i class="u" style="width:' +
        (100 - pw) +
        '%"></i></span>';
    }
  }
  const sig = JSON.stringify(part);
  if (sig === detailHtml) return;
  detailHtml = sig;
  $('d-name').innerHTML = part.name;
  $('d-sub').innerHTML = part.sub;
  $('d-say').innerHTML = part.say;
  $('d-sort').innerHTML = part.sort;
  $('d-rows').innerHTML = part.rows;
  $('d-tot').innerHTML = part.tot;
  $('d-table').hidden = !part.table;
}

const VIA_LABEL = {
  'title prefix': 'from the session title',
  'change on branch': 'from the openspec change on its branch',
  inferred: 'matched from branch and title words',
};

function categoryControl(row) {
  const key = escapeHtml(rowKey(row)),
    auto = row.item.category || '',
    label = row.category || NO_CATEGORY;
  const source = row.manualCategory
    ? 'set by you'
    : row.category
      ? VIA_LABEL[row.categoryFrom] || 'automatic'
      : 'no category yet';
  const grid = repoCategories()
    .map(
      (c) =>
        '<button type="button" data-setcat="' +
        key +
        '" data-cat="' +
        escapeHtml(c) +
        '" aria-pressed="' +
        (c === row.category) +
        '">' +
        escapeHtml(c) +
        '</button>'
    )
    .join('');
  const clear =
    '<button type="button" class="tr-cat-wide" data-setcat="' +
    key +
    '" data-cat="" aria-pressed="' +
    (row.category === '') +
    '">' +
    NO_CATEGORY +
    '</button>';
  const back = row.manualCategory
    ? '<button type="button" class="tr-cat-wide" data-setcat="' +
      key +
      '" data-cat="__auto">' +
      (auto ? 'Back to ' + escapeHtml(auto) + ' (automatic)' : 'Clear my choice') +
      '</button>'
    : '';
  return (
    '<details class="tr-cat" data-cat-for="' +
    key +
    '">' +
    '<summary class="tr-chip' +
    (row.manualCategory ? '' : ' auto') +
    (row.category ? '' : ' none') +
    '" title="' +
    escapeHtml(label + ': ' + source) +
    '" aria-label="' +
    escapeHtml('Category of ' + displayTitle(row.item) + ': ' + label + ', ' + source) +
    '">' +
    escapeHtml(label) +
    ' ▾</summary>' +
    '<div class="tr-menu tr-cat-menu"><div class="tr-menu-h">Category</div>' +
    '<div class="tr-cat-grid">' +
    grid +
    '</div>' +
    clear +
    back +
    '</div></details>'
  );
}

// Nothing is ever re-sorted for the operator: when the session speaks again the row says so, and
// the sorting stands until they confirm it or change it.
function sortControls(row) {
  const key = escapeHtml(rowKey(row));
  const focus =
    '<button type="button" class="tr-chip" data-focus="' +
    key +
    '" aria-pressed="' +
    row.focus +
    '">High focus</button>';
  // Cleanup takes the session off the board and lists it under Cleanup, whatever its category.
  const clean =
    '<button type="button" class="tr-chip" data-cleanup="' +
    key +
    '" aria-pressed="' +
    row.cleanup +
    '" title="' +
    (row.cleanup
      ? 'Listed under Cleanup. Press to put it back on the board.'
      : 'Take it off the board and list it under Cleanup') +
    '">Cleanup</button>';
  const recheck = row.newSinceSorted
    ? '<span class="tr-resort">New message since you sorted' +
      '<button type="button" data-confirm="' +
      key +
      '">Still right</button></span>'
    : '';
  return (
    '<div class="tr-sort" role="group" aria-label="' +
    escapeHtml('Sort ' + displayTitle(row.item)) +
    '">' +
    focus +
    categoryControl(row) +
    clean +
    recheck +
    '</div>'
  );
}
