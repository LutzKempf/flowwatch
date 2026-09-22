/**
 * The rules the triage view decides by: which group a session belongs in, what its category is,
 * how rows are ordered, and which category picks a view honours.
 *
 * Kept out of the page's inline script on purpose — these rules decide what the operator sees, so
 * they are unit-tested. The browser loads this file before the page script (window.Triage); Jest
 * requires it. No DOM, no storage, no fetch: the page passes the operator's stored sorting in and
 * writes whatever comes back.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Triage = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // Precedence order: the first group whose facts hold wins, so a broken session reads as broken
  // even when it also has an open pull request.
  const GROUPS = [
    { id: 'stuck', title: 'Stopped mid-work or broken', open: true },
    { id: 'answer', title: 'Needs your answer', open: true },
    { id: 'merge', title: 'Review or merge', open: true },
    { id: 'done', title: 'Finished: archive it', open: false },
  ];
  // The Sessions board lists every open conversation: the inbox's groups, then the
  // conversations the inbox has no record for, because they are not waiting on the operator.
  const BOARD_GROUPS = [...GROUPS, { id: 'working', title: 'Working, not waiting on you', open: true }];

  // The categories session titles use are the repo's own, from its MISSION.md: the inbox payload
  // carries them (`categories`), and the functions below take them as an argument.

  /** @param {object} item an /api/inbox item @returns {string} the group id it belongs in */
  function factBucket(item) {
    // A board conversation with no inbox record: the inbox lists every session waiting on the operator,
    // so one it does not list is not waiting, whatever else it says.
    if (item.waiting === false) return 'working';
    // Both error flags mean broken: the API's, and the app's own. A session broken by the app that
    // only checked the API flag would land in "Finished", which is the group nobody opens.
    if (item.state === 'abandoned' || item.api_error || item.app_error) return 'stuck';
    if (item.pending_question || item.asks) return 'answer';
    if (item.pr && item.pr.status === 'open') return 'merge';
    return 'done';
  }

  /** The operator's sorting is keyed by the session, not by its last message. */
  const sortingKeyOf = (item) => item.session_id || item.key;

  /**
   * One row per item: the endpoint's facts, plus whatever the operator has decided about it.
   * @param {Array<object>} items /api/inbox items
   * @param {object} sorting session id -> { focus?, category?, sortedKey, at }
   * @returns {Array<object>} rows
   */
  function rowsFrom(items, sorting) {
    const store = sorting || {};
    return (items || []).map((item) => {
      const pick = store[sortingKeyOf(item)] || null;
      const manualCategory = !!pick && typeof pick.category === 'string';
      const focus = !!(pick && pick.focus);
      return {
        item,
        bucket: factBucket(item),
        stuck: factBucket(item) === 'stuck',
        phase: item.phase == null ? null : item.phase,
        focus,
        cleanup: !!(pick && pick.cleanup), // sent to Cleanup by the operator, whatever its category
        manualCategory,
        category: manualCategory ? pick.category : item.category == null ? null : item.category,
        categoryFrom: manualCategory ? 'set by you' : item.category_from || null,
        // Nothing is ever cleared for the operator: the row says the session spoke again, and the
        // sorting stands until they confirm or change it. A session not waiting on them has no message
        // for them to re-read, so it never asks.
        newSinceSorted: item.waiting !== false && !!pick && !!pick.sortedKey && pick.sortedKey !== item.key,
      };
    });
  }

  /**
   * The operator's sorting with one change applied. Pure: returns a new map, and an entry with
   * nothing left in it is removed rather than kept as an empty shell.
   * @param {object} sorting current map
   * @param {object} item the item being sorted
   * @param {{focus?: boolean, cleanup?: boolean, category?: string|undefined}} changes `category:
   *   undefined` means "back to the automatic one"; `focus: false` / `cleanup: false` take the flag off
   * @param {string} at timestamp to stamp the entry with
   * @returns {object} a new sorting map
   */
  function applySorting(sorting, item, changes, at) {
    const key = sortingKeyOf(item);
    const next = { ...((sorting || {})[key] || {}), ...changes, sortedKey: item.key, at };
    if (!next.focus) delete next.focus;
    if (!next.cleanup) delete next.cleanup;
    if (typeof next.category !== 'string') delete next.category;
    const out = { ...(sorting || {}) };
    if (!next.focus && !next.cleanup && !('category' in next)) delete out[key];
    else out[key] = next;
    return out;
  }

  /**
   * The Sessions board's items: every open conversation once, never capped. The inbox's
   * items as it sent them, then each board session it has no record for, as an item not waiting on the
   * operator. A board session is joined to its conversation on the app session id, the join /api/lanes
   * makes; one with no title there (an earlier part of a continued conversation, or no app record) is
   * not a row of its own, and neither is one archived in the app: the operator closed it, while the
   * board keeps a session until it has been quiet for 7 days.
   * @param {{inbox: Array<object>, sessions: Array<object>, titles: object|null, now: number}} input
   *   /api/inbox items; the board's current sessions ({id, wt, cur, state, seen}); the /api/lanes titles,
   *   null before they load: each board session then stands alone under its folder
   * @returns {Array<{item: object, si: number}>} si = the item's index in `sessions`, -1 when it has none
   */
  function boardItems({ inbox, sessions, titles, now }) {
    const S = sessions || [];
    const bySession = new Map();
    S.forEach((s, si) => {
      if (!titles) {
        bySession.set('cli:' + s.id, si);
        return;
      }
      const t = titles[s.id];
      if (t && !t.app_archived) bySession.set(t.app_session_id || 'cli:' + s.id, si);
    });
    const listed = new Set();
    const out = (inbox || []).map((item) => {
      if (item.session_id) listed.add(item.session_id);
      const si = item.session_id ? bySession.get(item.session_id) : undefined;
      return { item, si: si == null ? -1 : si };
    });
    for (const [id, si] of bySession) {
      if (listed.has(id)) continue;
      const s = S[si];
      const t = (titles && titles[s.id]) || {};
      out.push({
        si,
        item: {
          key: 'board:' + id,
          waiting: false,
          session_id: t.app_session_id || null,
          app_archived: !!t.app_archived,
          title: t.title || s.wt || String(s.id),
          branch: t.branch || null,
          worktree: s.wt || null,
          category: t.category || null,
          category_from: t.category_from || null,
          phase: s.cur || null,
          phase_from: 'board',
          state: s.state === 'abandoned' ? 'abandoned' : 'working',
          since: s.seen ? new Date(s.seen).toISOString() : null,
          hours_waiting: s.seen ? Math.max(0, Math.round((now - s.seen) / 36e5)) : 0, // here: hours since it was last seen
        },
      });
    }
    return out;
  }

  /** Inside a group, the newest first. */
  const byNewest = (a, b) => a.item.hours_waiting - b.item.hours_waiting;

  /**
   * High focus is for work that needs thought, so it leads with the earliest stage. A session the
   * board has no phase for cannot claim a place in that order, so it goes last rather than being
   * given a phase it never reported.
   */
  const byEarliestPhase = (a, b) => {
    if (a.phase == null || b.phase == null) {
      if (a.phase == null && b.phase == null) return b.item.hours_waiting - a.item.hours_waiting;
      return a.phase == null ? 1 : -1;
    }
    return a.phase - b.phase || b.item.hours_waiting - a.item.hours_waiting;
  };

  /**
   * Whether a category is on offer at all: the inbox offers what the operator has not hidden.
   * Deliberately not keyed by view — today both views offer the same categories, and a view
   * argument nothing reads is a contract no test can hold. Cleanup, which lists the hidden
   * categories, does it through cleanupItems and offers no category chips.
   * @param {string|null} category
   * @param {Set} hidden categories the operator has hidden
   */
  function offeredIn(category, hidden) {
    return !(hidden && hidden.has(category));
  }

  /**
   * The filter the list actually applies. A pick that is no longer on offer is ignored: a pick
   * must never take rows off the screen with nothing there to explain it.
   * @returns {(category: string|null) => boolean}
   */
  function pickFor(picks, hidden) {
    const kept = [...(picks || [])].filter((c) => offeredIn(c, hidden));
    return (category) => kept.length === 0 || kept.includes(category);
  }

  /** The picks still on offer, as a new set. */
  function dropUnofferedPicks(picks, hidden) {
    return new Set([...(picks || [])].filter((c) => offeredIn(c, hidden)));
  }

  /**
   * What Cleanup lists: the sessions and stories of the hidden categories, everything while nothing
   * is hidden. A session goes by the category its inbox row shows, the operator's own included. A story
   * sits in every lane it has a delta for, so it is listed only when all of them are hidden: closing it
   * while one of its lanes is still shown would close work that card is showing.
   * @param {{rows: Array<object>, lanes: Array<object>, hidden: Set}} input inbox rows (rowsFrom), the
   *   /api/lanes lanes (each story in `stories` or `older`), and the hidden categories ('' = none)
   * @returns {{sessions: Array<object>, stories: Array<object>}} longest-waiting and longest-untouched first
   */
  function cleanupItems({ rows, lanes, hidden }) {
    const h = hidden || new Set();
    const inScope = (keys) => h.size === 0 || keys.every((k) => h.has(k));
    // A session the operator sent to Cleanup is listed whatever its category. With nothing hidden and
    // nothing sent, everything is listed; once something is sent, only what was chosen.
    const sent = (rows || []).some((r) => r.cleanup);
    const sessionIn = (r) => r.cleanup || (h.size ? h.has(r.category || '') : !sent);
    const sessions = (rows || []).filter(sessionIn).sort((a, b) => b.item.hours_waiting - a.item.hours_waiting);
    const byTopic = new Map();
    for (const l of lanes || []) {
      for (const c of [...(l.stories || []), ...(l.older || [])]) {
        const s = byTopic.get(c.topic) || {
          topic: c.topic,
          status: c.status,
          days_since_touched: c.days_since_touched,
          lanes: [],
        };
        if (!s.lanes.includes(l.name || '')) s.lanes.push(l.name || '');
        byTopic.set(c.topic, s);
      }
    }
    // No known touch sorts as the oldest of all.
    const untouched = (c) => (c.days_since_touched == null ? Infinity : c.days_since_touched);
    const stories = [...byTopic.values()]
      .filter((c) => inScope(c.lanes))
      .sort((a, b) => untouched(b) - untouched(a) || a.topic.localeCompare(b.topic));
    return { sessions, stories };
  }

  /**
   * The categories the operator can show or hide: the repo's own (MISSION.md), any lane the lanes payload
   * has outside them (the repo's inference can name one MISSION.md does not list), then '' for No category.
   * @param {Array<{name: string|null}>|null} lanes /api/lanes lanes, or null before the first read
   * @param {string[]} [categories] the repo's categories
   * @returns {string[]}
   */
  function categoriesOn(lanes, categories = []) {
    const extra = [...new Set((lanes || []).map((l) => l.name).filter((n) => n && !categories.includes(n)))].sort();
    return [...categories, ...extra, ''];
  }

  /** The app keeps this many characters of a new-session deep link's prompt and cuts the rest. */
  const CLOSE_OUT_LIMIT = 14336;

  // One item per line: whitespace inside a field is flattened, so a title cannot start a line of its own.
  const flat = (v) => String(v).replace(/\s+/g, ' ').trim();

  // The hand-off message: "/<skill>" first when the repo names one, then one line per item. A blank line
  // separates the parts, never starts the message.
  function closeOutText({ sessions = [], stories = [] }, skill) {
    const lines = skill ? ['/' + skill] : [];
    const part = (title) => lines.push(...(lines.length ? ['', title] : [title]));
    if (sessions.length) {
      part('Sessions:');
      for (const r of sessions) {
        const it = r.item || r;
        const pr =
          it.pr && it.pr.numbers && it.pr.numbers.length ? ` · PR #${it.pr.numbers.join(', #')} ${it.pr.status}` : '';
        lines.push(
          flat(
            `- ${it.title || '(untitled)'} · app session ${it.session_id || 'unknown'} · branch ${it.branch || 'none'}` +
              ` · worktree ${it.worktree || 'unknown'}${pr}`
          )
        );
      }
    }
    if (stories.length) {
      part('Stories:');
      for (const c of stories) {
        const touched = c.days_since_touched == null ? 'last touch unknown' : `touched ${c.days_since_touched}d ago`;
        lines.push(
          flat(`- openspec/changes/${c.topic} · ${c.status && c.status !== '-' ? c.status : 'no status'} · ${touched}`)
        );
      }
    }
    return lines.join('\n');
  }

  /**
   * The first message of a cleanup session, and the app link that opens one with it typed in.
   * The length is measured on the encoded prompt, which is never shorter than what the app keeps; a list
   * over the limit gets no link and the number of items to drop (stories first, then sessions), because
   * a cut list would start a session that silently leaves the rest behind. With no skill there is no session
   * to start: the list alone, to copy, and no link.
   * @param {{sessions: Array<object>, stories: Array<object>}} picked
   * @param {{folder: string, skill?: string|null}} where the canonical repo root the session opens in, and the
   *   repo's cleanup skill (cleanupSkillNote's `skill`)
   * @returns {{text: string, length: number, limit: number, url: string|null, drop: number}}
   */
  function closeOutPrompt(picked, { folder, skill = null }) {
    const text = closeOutText(picked, skill);
    const length = encodeURIComponent(text).length;
    if (!skill) return { text, length, limit: CLOSE_OUT_LIMIT, url: null, drop: 0 };
    if (length <= CLOSE_OUT_LIMIT) {
      const url = folder
        ? 'claude://code/new?q=' + encodeURIComponent(text) + '&folder=' + encodeURIComponent(folder)
        : null;
      return { text, length, limit: CLOSE_OUT_LIMIT, url, drop: 0 };
    }
    const s = [...(picked.sessions || [])];
    const c = [...(picked.stories || [])];
    let drop = 0;
    while (
      (s.length || c.length) &&
      encodeURIComponent(closeOutText({ sessions: s, stories: c }, skill)).length > CLOSE_OUT_LIMIT
    ) {
      if (c.length) c.pop();
      else s.pop();
      drop += 1;
    }
    return { text, length, limit: CLOSE_OUT_LIMIT, url: null, drop };
  }

  /**
   * The line the Sessions board shows when the Claude app's session records folder was not found (Linux, or not
   * where the app keeps it): the board then runs on the session hooks alone.
   * @param {object|null} inbox the /api/inbox payload
   * @returns {string|null} null while the folder was found, or before the inbox loads
   */
  function recordsNote(inbox) {
    const f = inbox && inbox.records_folder;
    if (!f || f.found) return null;
    return (
      'Titles and waiting states come from the session hooks only: the Claude app’s session records were not found (' +
      f.looked +
      ').'
    );
  }

  const NAME_A_SKILL =
    'To start one from here, name your cleanup skill in flowwatch.json: "cleanup": { "skill": "<name>" }.';

  /**
   * What Cleanup says about the repo's cleanup skill (flowwatch.json "cleanup": { "skill": "<name>" }), and whether
   * a hand-off may link to a session running it. Said before anything is picked, so no one ticks thirty boxes to
   * learn the button leads nowhere.
   * @param {{name: string|null, state: 'installed'|'missing'|'not-set'|'invalid'}|null} skill /api/lanes'
   *   `cleanup_skill`; null before it answers
   * @returns {{skill: string|null, link: boolean, warn: boolean, text: string, noLink: string|null}} `skill`: what
   *   the hand-off message starts with (null: the list alone); `text`: the line over the list, a warning when
   *   `warn`; `noLink`: why the hand-off has no link
   */
  function cleanupSkillNote(skill) {
    if (!skill)
      return {
        skill: null,
        link: false,
        warn: false,
        text: 'Checking for this repo’s cleanup skill…',
        noLink: 'No link yet: the cleanup skill has not been checked.',
      };
    const n = skill.name;
    if (skill.state === 'installed')
      return {
        skill: n,
        link: true,
        warn: false,
        noLink: null,
        text: 'Closing hands what you pick to a new session running /' + n + '. Nothing is closed from this page.',
      };
    if (skill.state === 'missing')
      return {
        skill: n,
        link: false,
        warn: true,
        text:
          'The cleanup skill /' +
          n +
          ' is not installed on this box (~/.claude/skills/' +
          n +
          '/SKILL.md), so there is ' +
          'no session to hand these to yet. You can still pick items and read the message it would get.',
        noLink: 'No link: /' + n + ' is not installed on this box, so the session would have nothing to run.',
      };
    const invalid = skill.state === 'invalid';
    return {
      skill: null,
      link: false,
      warn: invalid,
      text:
        (invalid
          ? '"cleanup.skill" in flowwatch.json is not a skill name (letters, digits, "-", "_" and "." only)'
          : 'No cleanup skill is named for this repo') +
        ', so closing gives you the list to copy into a session of your own. ' +
        NAME_A_SKILL,
      noLink: 'No link: no cleanup skill is named for this repo. Copy the list into a session in that folder.',
    };
  }

  return {
    GROUPS,
    BOARD_GROUPS,
    factBucket,
    rowsFrom,
    boardItems,
    applySorting,
    sortingKeyOf,
    byNewest,
    byEarliestPhase,
    offeredIn,
    pickFor,
    dropUnofferedPicks,
    cleanupItems,
    closeOutPrompt,
    cleanupSkillNote,
    recordsNote,
    CLOSE_OUT_LIMIT,
    categoriesOn,
  };
});
