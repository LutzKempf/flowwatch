// Shared render helpers for the two dashboards (no framework, no deps).

// Connection badge: a failed poll shows a small fixed "collector offline" pill
// (id conn-status); the next successful poll removes it. The DOM keeps last data.
function setConnStatus(offline) {
  let el = document.getElementById('conn-status');
  if (!offline) {
    if (el) el.remove();
    return;
  }
  if (el) return;
  el = document.createElement('div');
  el.id = 'conn-status';
  el.textContent = '⚠ collector offline';
  el.style.cssText =
    'position:fixed;top:10px;right:12px;z-index:99;' +
    'font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.04em;' +
    'color:#ef5b5b;background:rgba(239,91,91,.12);border:1px solid #ef5b5b;' +
    'padding:4px 9px;border-radius:2px';
  document.body.appendChild(el);
}

// The collector answered, but could not build what was asked: say its reason, and never "offline"
// (a missing folder would otherwise read as the collector being down). null clears it.
function setLoadError(reason) {
  let el = document.getElementById('load-error');
  if (!reason) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = 'load-error';
    el.setAttribute('role', 'status');
    el.style.cssText =
      'position:fixed;top:10px;right:12px;z-index:99;max-width:60ch;' +
      'font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.02em;' +
      'color:#f5b544;background:rgba(245,181,68,.12);border:1px solid #f5b544;padding:4px 9px;border-radius:2px';
    document.body.appendChild(el);
  }
  el.textContent = '⚠ ' + reason;
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]
  );
}

// The exact text an agent needs, kept out of the operator's way.
function forAgent(intro, text) {
  return text
    ? '<details class="for-agent"><summary>For the agent</summary><p class="empty-note">' +
        escapeHtml(intro) +
        '</p><pre>' +
        escapeHtml(text) +
        '</pre></details>'
    : '';
}

// The setup banner, on both pages: shown while a required item needs doing, listing
// everything that does — required first, each with its SETUP.md step. It is /api/setup's list, the one
// `npx flowwatch check` prints. A panel the repo turned off also leaves the sidebar here.
function renderSetup(setup) {
  window.SETUP = setup;
  for (const id of ['stages', 'ideas', 'gates', 'specs']) {
    const item = setup && setup.items && setup.items.find((i) => i.id === id);
    const link = document.querySelector('#nav a[data-nav="' + id + '"]');
    if (link) link.hidden = !!(item && item.state === 'off');
  }
  const el = document.getElementById('setup-banner');
  if (!el) return;
  const items = (setup && setup.banner) || [];
  el.hidden = !items.length;
  el.innerHTML = !items.length
    ? ''
    : '<b>Flowwatch is not fully set up in this repo.</b> ' +
      'Ask your agent to follow the Flowwatch SETUP.md. What is left:<ul>' +
      items
        .map(
          (i) =>
            '<li>' +
            (i.required ? '' : '<span class="opt">optional</span> ') +
            escapeHtml(i.title) +
            ': ' +
            escapeHtml(i.detail) +
            ' <span class="step">(step ' +
            escapeHtml(i.step) +
            ')</span></li>'
        )
        .join('') +
      '</ul>' +
      forAgent(
        'Run this in the repo for the same list; it exits 1 until the required items are done:',
        'npx flowwatch check'
      );
}

// The demo (a static snapshot, no collector; lib/data.js): every page says what it is, and Sessions says in one line
// how to read its board. The setup banner goes, for good: it asks the viewer to set Flowwatch up in their own repo,
// and a visitor to the demo has none. demo is null on a live page, which this leaves as it is.
const DEMO_ORIENTATION = "Each row is an AI agent's session; the top rows are waiting on a person.";
function renderDemo(demo) {
  if (!demo) return;
  const day = new Date(demo.snapshotAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const setup = document.getElementById('setup-banner');
  if (setup) setup.remove();
  const wrap = document.querySelector('.wrap');
  if (wrap) {
    wrap.insertAdjacentHTML(
      'afterbegin',
      '<div class="demo-banner" id="demo-banner" role="note">' +
        escapeHtml(
          'Demo: a snapshot of ' + demo.project + "'s dashboards on " + day + '. Nothing you click is saved.'
        ) +
        '</div>'
    );
  }
  const sessions = document.querySelector('[data-panel="sessions"] .panel-title');
  if (sessions)
    sessions.insertAdjacentHTML('afterend', '<p class="demo-orient">' + escapeHtml(DEMO_ORIENTATION) + '</p>');
}

// An optional panel that has no data to show says why, to the operator: not set up
// (what it would show, and the setup step), off (the repo does not use it), or an error with its reason.
function panelNote(panel, what, agentText) {
  if (panel.state === 'off')
    return '<p class="empty-note">This repo does not use this panel: flowwatch.json turns it off.</p>';
  if (panel.state === 'error') {
    return (
      '<p class="todo">Could not be read: ' +
      escapeHtml(panel.reason || 'unknown reason') +
      '.</p>' +
      '<p class="empty-note">Ask your agent to check flowwatch.json (the Flowwatch SETUP.md, step 4 “Optional panels”).</p>'
    );
  }
  return (
    '<p class="empty-note"><b>Not set up in this repo.</b> ' +
    escapeHtml(what) +
    ' Ask your agent to follow ' +
    'the Flowwatch SETUP.md, step 4 “Optional panels”, to set it up, or to turn it off if this repo will never need it.</p>' +
    forAgent(
      'In flowwatch.json (at the repo root, or in docs/), point the panel at its source, or turn it off:',
      agentText
    )
  );
}
// What an agent writes in flowwatch.json for a repo-fed panel: its feed as a command or a file, or off.
function feedAgent(key) {
  return (
    '"' +
    key +
    '": { "command": ["node", "scripts/' +
    key +
    '.js"] }\nor\n"' +
    key +
    '": { "file": "<path to a JSON file>" }\nor\n"' +
    key +
    '": false\n\nWhat the command prints, or the file holds, is the ' +
    key +
    " format in Flowwatch's docs/formats.md."
  );
}
const STAGES_WHAT =
  'This panel shows how far each workstream has got through the stages this repo names, from a stages feed the repo supplies.';
const IDEAS_WHAT =
  'This panel lists every idea this repo has evaluated, with its verdict, from an ideas feed the repo supplies.';
const GATES_WHAT =
  "This panel shows which gates this repo's gate runner is running and which wait, in the order it starts them, from a gates feed the repo supplies.";

// The mission is the repo's own MISSION.md. Without one the hero says so to the operator, names the setup
// step, and keeps the template for their agent; a file that did not read completely says which lines.
function renderMission(m) {
  const title = document.getElementById('mission-title');
  const statement = document.getElementById('mission-statement');
  const note = document.getElementById('mission-note');
  if (!title || !statement || !note) return;
  if (!m || !m.file) {
    title.innerHTML = '<span class="todo">No mission yet</span>';
    statement.textContent =
      'Flowwatch doesn’t know what this repo is trying to achieve, so it can’t show how close it is. ' +
      'Ask your agent to follow the Flowwatch SETUP.md, step 3 “Write the mission”.';
    note.innerHTML = forAgent(
      'Create MISSION.md at the repo root (or in docs/) from this template and fill in every <…> part:',
      m && m.template
    );
    return;
  }
  title.innerHTML = m.title
    ? 'Mission: <span style="color:var(--green)">' + escapeHtml(m.title) + '</span>'
    : '<span class="todo">The mission has no title</span>';
  statement.textContent = m.statement || '';
  note.innerHTML =
    m.problems && m.problems.length
      ? '<p class="todo">' +
        escapeHtml(m.file) +
        ' could not be read completely. Ask your agent to fix:</p>' +
        '<ul class="mission-problems">' +
        m.problems.map((p) => '<li>' + escapeHtml(p) + '</li>').join('') +
        '</ul>'
      : '';
}

// The footer names what this page was built from, as the collector reported it.
function renderSources(src, panels) {
  const el = document.getElementById('mc-sources');
  if (!el || !src) return;
  const has = (k) => panels && panels[k] && panels[k].state === 'data';
  const parts = [
    src.mission || 'no MISSION.md',
    src.specs ? 'openspec/specs' : 'no openspec/specs',
    src.changes ? 'openspec/changes' : 'no openspec/changes',
    'git log',
    has('stages') ? 'the stages feed' : null,
    has('ideas') ? 'the ideas feed' : null,
    has('value') ? 'the value feed' : null,
  ].filter(Boolean);
  const demo = typeof Data !== 'undefined' && Data.demo;
  el.textContent =
    'Source: ' +
    parts.join(' + ') +
    (demo
      ? ' · a snapshot taken ' + new Date(demo.snapshotAt).toISOString().slice(0, 10)
      : ' · live via /api/mission (30 s poll)');
}

// The value feed's figures, as the Mission page's headline: one chip per sentence, in the feed's tone. The
// feed's text is escaped first and only then are its **bold** marks read, so nothing a feed writes is markup.
function renderValue(value, panel) {
  const el = document.getElementById('verdict');
  if (!el) return;
  if (panel && panel.state === 'off') {
    el.innerHTML = '';
    return;
  }
  if (panel && panel.state === 'not-set-up') {
    el.innerHTML =
      '<span class="flag">value figures are not set up in this repo (the Flowwatch SETUP.md, step 4)</span>';
    return;
  }
  if (panel && panel.state === 'error') {
    el.innerHTML =
      '<span class="flag warn">value figures could not be read: ' +
      escapeHtml(panel.reason || 'unknown reason') +
      '</span>';
    return;
  }
  if (!value) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = value.figures
    .map(
      (f) =>
        '<span class="flag' +
        (f.tone && f.tone !== 'neutral' ? ' ' + f.tone : '') +
        '">' +
        escapeHtml(f.text).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>') +
        '</span>'
    )
    .join('');
}

// A spec-derived status (statusForSpecs on the server) has a pill of its own. A stage-derived one is the
// stages feed's own label, so its pill says how far along the repo's stages it is instead: the last stage
// reads done, past halfway building, before that early.
const MS_PILL_CLASS = { 'specs-complete': 'p-live', building: 'p-built', scoped: 'p-early', 'no-specs': 'p-stall' };
function pillClass(m, stageCount) {
  if (m.frontier == null) return MS_PILL_CLASS[m.status] || 'p-early';
  return m.frontier >= stageCount ? 'p-live' : 2 * m.frontier > stageCount ? 'p-built' : 'p-early';
}

// The milestones and the focus are the repo's own MISSION.md. A line it could not read is listed here as
// well as under the mission, so a milestone never disappears from the rail without saying so.
function renderMilestones(list, mission, stages) {
  const el = document.getElementById('ms-rail');
  if (!el) return;
  // The focus line sits above the rail, so the rail holds milestones only.
  const focusEl = document.getElementById('ms-focus');
  if (focusEl) {
    focusEl.hidden = !(mission && mission.focus);
    focusEl.innerHTML = mission && mission.focus ? '<b>Focus:</b> ' + escapeHtml(mission.focus) : '';
  }
  const left = ((mission && mission.problems) || []).filter((p) => /^milestone/.test(p));
  const leftHtml = left.length
    ? '<p class="todo">Lines in ' +
      escapeHtml(mission.file) +
      ' not shown here:</p>' +
      '<ul class="mission-problems">' +
      left.map((p) => '<li>' + escapeHtml(p) + '</li>').join('') +
      '</ul>'
    : '';
  if (!list.length) {
    el.innerHTML =
      '<p class="empty-note">No milestones yet. They come from the “Milestones” section of MISSION.md: ' +
      'ask your agent to follow the Flowwatch SETUP.md, step 3 “Write the mission”.</p>' +
      leftHtml +
      forAgent(
        'One line per milestone under "## Milestones" in MISSION.md:',
        '- `first-milestone` What done looks like — specs: <openspec capability>; workstreams: <stages feed row id>'
      );
    return;
  }
  const n = stages ? stages.stages.length : 0; // a frontier exists only while the stages feed has data
  el.innerHTML =
    list
      .map(
        (m, i) => `
    <div class="ms"><div class="idx">${i}</div>
      <div><div class="t">${escapeHtml(m.title)}</div>
        <div class="d">${m.specImplemented}/${m.specTotal} scenarios · ${m.frontier != null ? 'frontier ' + m.frontier + '/' + n : 'no frontier declared'}</div></div>
      <span class="pill ${pillClass(m, n)}">${escapeHtml(m.status)}</span></div>`
      )
      .join('') + leftHtml;
}

// The cell states of the stages format, in its order (server/panels/stages.js CELL_STATES), and what each
// means in words: the legend lists the ones on the grid, and each cell's tooltip names its own.
const CELL_WORDS = {
  passed: 'passed',
  inferred: 'assumed passed, no evidence named',
  frontier: 'frontier, the furthest stage reached',
  skipped: 'skipped',
  failed: 'failed',
  voided: 'voided by an earlier failure',
  none: 'not reached',
};
const CELL_GLYPH = { passed: '✓', inferred: '✓', frontier: '', skipped: 'skip', failed: '✗', voided: '✓', none: '' };

// The stages feed as a grid: the repo's own stage names across the top, one row per workstream. Every word on
// it is the feed's, escaped; the legend names only the states the grid shows.
function renderStages(st, panel) {
  const grid = document.getElementById('lc-grid');
  if (!grid) return;
  const legend = document.getElementById('lc-legend');
  const note = document.getElementById('lc-warn');
  if (panel && panel.state !== 'data') {
    grid.innerHTML = '';
    if (legend) legend.hidden = true;
    if (note) note.innerHTML = panelNote(panel, STAGES_WHAT, feedAgent('stages'));
    return;
  }
  if (!st) return;
  const n = st.stages.length;
  grid.style.gridTemplateColumns = '172px repeat(' + n + ',minmax(30px,1fr))';
  let html =
    '<div></div>' +
    st.stages.map((name, i) => '<div class="lch"><b>' + (i + 1) + '</b>' + escapeHtml(name) + '</div>').join('');
  for (const w of st.workstreams) {
    const cls = w.frontier == null ? 'legacy' : w.frontier >= n ? 'live' : 'early';
    html +=
      '<div class="lcname ' +
      cls +
      '"><b>' +
      escapeHtml(w.name) +
      '</b>' +
      '<small>' +
      escapeHtml(w.role || 'no role declared') +
      (w.frontier == null ? ' · no frontier' : '') +
      '</small></div>';
    html += w.cells
      .map(
        (c, i) =>
          '<div class="c ' +
          c +
          '" title="' +
          escapeHtml(st.stages[i] + ': ' + CELL_WORDS[c]) +
          '">' +
          (c === 'frontier' ? i + 1 : CELL_GLYPH[c]) +
          '</div>'
      )
      .join('');
  }
  grid.innerHTML = html;
  if (legend) {
    const shown = new Set(st.workstreams.flatMap((w) => w.cells));
    legend.innerHTML = Object.keys(CELL_WORDS)
      .filter((c) => shown.has(c))
      .map((c) => '<span><i class="sw ' + c + '"></i>' + CELL_WORDS[c] + '</span>')
      .join('');
    legend.hidden = !shown.size;
  }
  if (note) {
    note.innerHTML = st.warnings.length
      ? '<div class="capnote"><b>Feed warnings:</b> ' + st.warnings.map(escapeHtml).join(' · ') + '</div>'
      : '';
  }
}

const IDEA_WORDS = {
  closed: 'ruled out',
  inconclusive: 'inconclusive',
  open: 'open or promising',
  unclassified: 'verdict not sorted',
};

// Every idea the ideas feed lists, grouped as the feed groups them; the counts are the collector's. Open
// sections and ideas stay open across the 30 s redraw. Every word is the feed's, escaped.
function renderIdeas(r, panel) {
  const el = document.getElementById('ideas');
  if (!el) return;
  const sum = document.getElementById('ideas-sum');
  const card = document.getElementById('ideas-card');
  const legend = card && card.querySelector && card.querySelector('.legend');
  if (legend) legend.hidden = !!(panel && panel.state !== 'data');
  if (panel && panel.state !== 'data') {
    if (sum) sum.innerHTML = panelNote(panel, IDEAS_WHAT, feedAgent('ideas'));
    el.innerHTML = '';
    return;
  }
  if (!r) return;
  const open = new Set([...el.querySelectorAll('details[open]')].map((d) => d.dataset.key));
  const total = { closed: 0, inconclusive: 0, open: 0, unclassified: 0 };
  let ideas = 0;
  const counts = (c) =>
    Object.keys(IDEA_WORDS)
      .filter((k) => c[k])
      .map((k) => '<span class="ib ' + k + '">' + c[k] + ' ' + IDEA_WORDS[k] + '</span>')
      .join(' · ');
  el.innerHTML = r.sections
    .map((s) => {
      for (const k in total) total[k] += s.counts[k];
      ideas += s.ideas.length;
      const n = s.ideas.length;
      const bar = Object.keys(IDEA_WORDS)
        .map((k) => (s.counts[k] ? '<i class="' + k + '" style="width:' + (100 * s.counts[k]) / n + '%"></i>' : ''))
        .join('');
      const key = 's:' + s.title;
      return (
        '<details class="idsec" data-key="' +
        escapeHtml(key) +
        '"' +
        (open.has(key) ? ' open' : '') +
        '>' +
        '<summary><b>' +
        escapeHtml(s.title) +
        '</b><span class="idn">' +
        n +
        ' ideas</span>' +
        '<span class="idbar">' +
        bar +
        '</span><span class="idc">' +
        counts(s.counts) +
        (s.latest ? ' · latest ' + escapeHtml(s.latest) : '') +
        '</span></summary>' +
        s.ideas
          .map((i) => {
            // An idea without a number keeps its open state by its section and name.
            const ik = 'i:' + (i.n != null ? i.n : s.title + '/' + i.name);
            return (
              '<details class="idea ' +
              i.bucket +
              '" data-key="' +
              escapeHtml(ik) +
              '"' +
              (open.has(ik) ? ' open' : '') +
              '>' +
              '<summary><span class="no">' +
              (i.n != null ? '#' + escapeHtml(i.n) : '') +
              '</span><span class="nm">' +
              escapeHtml(i.name) +
              '</span>' +
              '<span class="vd">' +
              escapeHtml(i.verdict) +
              '</span><span class="dt">' +
              escapeHtml(i.date || '') +
              '</span></summary>' +
              '<div class="ev">' +
              escapeHtml(i.evidence || '') +
              '<div class="src">' +
              escapeHtml(i.docs || '') +
              '</div></div></details>'
            );
          })
          .join('') +
        '</details>'
      );
    })
    .join('');
  if (sum) {
    sum.innerHTML =
      '<b>' +
      ideas +
      ' ideas evaluated</b> · ' +
      counts(total) +
      (r.source ? ' — from <span class="mono">' + escapeHtml(r.source) + '</span>' : '') +
      (r.warnings.length
        ? '<div class="capnote"><b>Rows not read:</b> ' + r.warnings.map(escapeHtml).join(' · ') + '</div>'
        : '');
  }
}

function renderSpecBars(caps, src, panel) {
  const el = document.getElementById('spec-bars');
  if (!el) return;
  // Specs turned off, or its settings unreadable: no spec figures at all, rather than zeros that read as
  // "no progress".
  const off = Boolean(panel && (panel.state === 'off' || panel.state === 'error'));
  for (const k of ['total', 'implemented', 'active-changes']) {
    const n = document.querySelector('[data-bind="' + k + '"]');
    if (n && n.closest) n.closest('.stat').hidden = off;
  }
  if (off) {
    el.innerHTML = panelNote(panel);
    return;
  }
  // An empty list is a state, said out loud: no folder is not the same claim as an empty one.
  if (!Object.keys(caps).length) {
    el.innerHTML =
      '<p class="empty-note">' +
      (src && src.specs === false
        ? 'No specs yet. This panel counts the scenarios in openspec/specs, and this repo has no such folder. Specs are optional.'
        : 'No capability specs in openspec/specs yet.') +
      '</p>';
    return;
  }
  el.innerHTML = Object.entries(caps)
    .map(([name, c]) => {
      const pct = (n) => (c.total ? Math.round((100 * n) / c.total) : 0);
      return `<div class="bar"><div class="nm" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
      <div class="track"><i class="seg-i" style="width:${pct(c.implemented)}%"></i><i class="seg-b" style="width:${pct(c.known_broken)}%"></i><i class="seg-a" style="width:${pct(c.aspirational)}%"></i></div>
      <div class="pct">${c.implemented}/${c.total}</div></div>`;
    })
    .join('');
}
