// Cleanup: the sessions and stories the operator can close. The page closes nothing itself; it hands the picked
// items to a cleanup session, through a link that only opens one.
import { IN_APP, NO_CATEGORY, PHASES, age, displayTitle, factTags } from './format.js';
import { currentRows, rowKey } from './rows.js';
import { hiddenCats, triageOpen, ui } from './state.js';

export const cleanupNow = () =>
  Triage.cleanupItems({ rows: currentRows(), lanes: (window.LANES && window.LANES.lanes) || [], hidden: hiddenCats });
const pickOfSession = (r) => 's:' + Triage.sortingKeyOf(r.item);
const pickOfStory = (c) => 'c:' + c.topic;
export const cleanupIds = (c) => [...c.sessions.map(pickOfSession), ...c.stories.map(pickOfStory)];
// A pick that left Cleanup is dropped, so an item coming back is never found ticked.
export function prunePicks() {
  const listed = new Set(cleanupIds(cleanupNow()));
  ui.cleanupPicked = new Set([...ui.cleanupPicked].filter((id) => listed.has(id)));
}

export function cleanupBody(clean) {
  const L = window.LANES,
    ids = cleanupIds(clean),
    picked = ids.filter((id) => ui.cleanupPicked.has(id)).length;
  const box = (id, label, strip) =>
    '<input type="checkbox" id="pick-' +
    escapeHtml(id) +
    '" data-pick="' +
    escapeHtml(id) +
    '"' +
    (ui.cleanupPicked.has(id) ? ' checked' : '') +
    '><div class="tr-title"><label for="pick-' +
    escapeHtml(id) +
    '">' +
    escapeHtml(label) +
    '</label>' +
    (strip || '') +
    '</div>';
  // A session the operator sent here says so, and can be put back on the board from here.
  const sent = (r) =>
    r.cleanup
      ? ' <button type="button" class="tr-chip" data-cleanup="' +
        escapeHtml(rowKey(r)) +
        '" aria-pressed="true" title="You sent this session here. Press to put it back on the board.">sent by you ✕</button>'
      : '';
  const sessionRow = (r) =>
    '<div class="tr-clean-row" data-clean="' +
    escapeHtml(pickOfSession(r)) +
    '">' +
    box(pickOfSession(r), displayTitle(r.item), phaseStrip(r.item)) +
    '<span class="lane-tag">' +
    escapeHtml(r.category || NO_CATEGORY) +
    '</span><span class="when">' +
    age(r.item.hours_waiting) +
    '</span>' +
    '<div class="tr-meta">' +
    escapeHtml(factTags(r.item)) +
    sent(r) +
    '</div></div>';
  const storyRow = (c) =>
    '<div class="tr-clean-row" data-clean="' +
    escapeHtml(pickOfStory(c)) +
    '">' +
    box(pickOfStory(c), readableTopic(c.topic)) +
    '<span class="lane-tag">' +
    escapeHtml(c.lanes.map((n) => n || NO_CATEGORY).join(' · ')) +
    '</span>' +
    '<span class="when">' +
    (c.days_since_touched == null ? '' : c.days_since_touched + 'd') +
    '</span>' +
    '<div class="tr-meta">' +
    escapeHtml(
      [
        'openspec/changes/' + c.topic,
        c.status && c.status !== '-' ? c.status : 'no status',
        c.days_since_touched == null ? 'last touch unknown' : 'touched ' + c.days_since_touched + 'd ago',
      ].join(' · ')
    ) +
    '</div></div>';
  // The repo's own cleanup skill (flowwatch.json), said before anything is picked (Triage.cleanupSkillNote).
  const note = Triage.cleanupSkillNote(L && L.cleanup_skill);
  const skill = '<p class="' + (note.warn ? 'tr-warn' : 'tr-caption') + '">' + escapeHtml(note.text) + '</p>';
  const bar =
    '<div class="tr-cleanbar"><label class="tr-pickall"><input type="checkbox" data-pick-all' +
    (ids.length && picked === ids.length ? ' checked' : '') +
    (ids.length ? '' : ' disabled') +
    '> Select all</label>' +
    '<span class="tr-count">' +
    picked +
    ' of ' +
    ids.length +
    ' selected</span>' +
    '<button type="button" class="tr-close-btn" data-close-picked' +
    (picked ? '' : ' disabled') +
    ' aria-expanded="' +
    (ui.handoffOpen && picked > 0) +
    '">Close selected…</button></div>';
  const group = (id, title, list, row) =>
    '<details class="tr-group" data-group="' +
    id +
    '"' +
    (triageOpen.has(id) ? ' open' : '') +
    '><summary>' +
    title +
    ' <span>' +
    list.length +
    '</span></summary>' +
    list.map(row).join('') +
    '</details>';
  const picks = {
    sessions: clean.sessions.filter((r) => ui.cleanupPicked.has(pickOfSession(r))),
    stories: clean.stories.filter((c) => ui.cleanupPicked.has(pickOfStory(c))),
  };
  return (
    skill +
    bar +
    (ui.handoffOpen && picked ? handoffPanel(L, picks) : '') +
    (clean.sessions.length ? group('clean-sessions', 'Sessions', clean.sessions, sessionRow) : '') +
    (clean.stories.length ? group('clean-stories', 'Stories', clean.stories, storyRow) : '') +
    (ids.length ? '' : '<div class="tr-empty">' + (L ? 'Nothing to close here.' : 'Loading the stories…') + '</div>')
  );
}

function handoffPanel(L, picks) {
  const n = picks.sessions.length,
    m = picks.stories.length;
  const what = [n ? n + ' session' + (n === 1 ? '' : 's') : '', m ? m + ' stor' + (m === 1 ? 'y' : 'ies') : '']
    .filter(Boolean)
    .join(' and ');
  const note = Triage.cleanupSkillNote(L && L.cleanup_skill);
  const p = Triage.closeOutPrompt(picks, { folder: IN_APP && L && L.repo_root, skill: note.skill });
  const where = escapeHtml((L && L.repo_root) || 'the repo');
  // No link that would start a session with nothing to run, a cut list, or the wrong folder.
  const action = !note.link
    ? '<p class="tr-warn">' + escapeHtml(note.noLink) + '</p>'
    : p.drop
      ? '<p class="tr-warn">No link: this list is ' +
        p.length +
        ' characters encoded, and the app keeps ' +
        p.limit +
        ' and cuts the rest. Untick ' +
        p.drop +
        ' item' +
        (p.drop === 1 ? '' : 's') +
        ' and close them in a second round.</p>'
      : !p.url
        ? '<p class="tr-warn">No link: the collector did not report the repo folder, so the session would open in the wrong place.</p>'
        : '<a class="tr-close-btn" data-handoff-start href="' +
          escapeHtml(p.url) +
          '">Open a session running /' +
          escapeHtml(note.skill) +
          '</a>';
  // With a skill, what happens next is the skill's to decide; with none, the list is the hand-off, open to copy.
  const intro = note.skill
    ? '<p>A new Claude Code session opens in the app, in ' +
      where +
      ', with this list typed in after <b>/' +
      escapeHtml(note.skill) +
      '</b>. Nothing starts until you press send; then the skill decides what to close, and asks you what it needs to.</p>'
    : '<p>No cleanup skill is named for this repo, so there is no session to open from here. Copy the list into a Claude ' +
      'Code session in ' +
      where +
      ' and say what should happen to it.</p>';
  return (
    '<div class="tr-handoff" role="region" aria-label="Hand off to a cleanup session">' +
    '<h4>Hand ' +
    escapeHtml(what) +
    ' to a cleanup session</h4>' +
    intro +
    '<details class="tr-firstmsg"' +
    (ui.handoffMsgOpen || !note.skill ? ' open' : '') +
    '><summary>' +
    (note.skill ? 'First message it gets' : 'The list to copy') +
    '</summary><pre>' +
    escapeHtml(p.text) +
    '</pre></details>' +
    '<div class="tr-handoff-actions">' +
    action +
    '<button type="button" class="tr-link" data-handoff-cancel>Cancel</button></div>' +
    (note.skill ? '<p>If the app does not open, copy the first message into a new session in that folder.</p>' : '') +
    '</div>'
  );
}

const PHASE_GROUPS = [
  [1, 4],
  [5, 8],
  [9, 12],
];

// The same 12-phase strip the board draws. A session the board has never seen gets an empty track
// that says so on hover — never a filled cell, which would be a phase nobody reported.
function phaseStrip(it) {
  const known = it.phase != null;
  const groups = PHASE_GROUPS.map(([from, to]) => {
    let cells = '';
    for (let p = from; p <= to; p++) {
      const cls = known && p < it.phase ? 'done' : known && p === it.phase ? 'cur ' + it.state : '';
      cells += '<span class="pc ' + cls + '"></span>';
    }
    return '<span class="pgroup">' + cells + '</span>';
  }).join('');
  const tip = known
    ? 'Now at ' + it.phase + ' · ' + PHASES[it.phase - 1][0]
    : 'No phase yet · this session has not reached the board';
  return (
    '<span class="phases' +
    (known ? '' : ' unknown') +
    '" role="img" aria-label="' +
    escapeHtml(tip) +
    '" data-tip="' +
    escapeHtml(tip) +
    '">' +
    groups +
    '</span>'
  );
}

// A dated change folder "<date>-guest-address-form" reads as "Guest address form"; the folder stays in the tooltip.
const readableTopic = (t) => {
  const s = String(t)
    .replace(/^\d{4}-\d{2}-\d{2}-/, '')
    .replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
