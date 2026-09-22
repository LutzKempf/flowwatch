const fs = require('fs');
const path = require('path');

/**
 * A repo's MISSION.md: what Flowwatch shows as the repo's mission, focus, milestones and session
 * categories. Read by headings, no markdown library: `# title`, the first paragraph under it, then
 * `## Focus`, `## Milestones`, `## Categories` in any order.
 */

/** @typedef {{id: string, title: string, specs: string[], workstreams: string[]}} Milestone */

const WHERE = ['MISSION.md', path.join('docs', 'MISSION.md')];

/**
 * @param {string} repoRoot the repo the collector runs in
 * @returns {{path: string, text?: string, error?: string}|null} the root's MISSION.md, else docs/MISSION.md,
 *   else null. Only "no such file" means absent: a file that is there but cannot be read comes back with
 *   `error`, so a broken read is never shown as "No mission yet".
 */
function findMissionFile(repoRoot) {
  for (const rel of WHERE) {
    const p = path.join(repoRoot, rel);
    try {
      return { path: p, text: fs.readFileSync(p, 'utf8') };
    } catch (e) {
      const err = /** @type {NodeJS.ErrnoException} */ (e);
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') return { path: p, error: err.message };
    }
  }
  return null;
}

/**
 * Paragraphs of a block of lines: runs of non-empty lines, joined with single spaces.
 * @param {string[]} lines
 * @returns {string[]}
 */
function paragraphs(lines) {
  const out = [];
  /** @type {string[]} */
  let cur = [];
  for (const l of [...lines, '']) {
    if (l.trim()) cur.push(l.trim());
    else if (cur.length) {
      out.push(cur.join(' '));
      cur = [];
    }
  }
  return out;
}

/** @type {(s: string|undefined) => string[]} */
const listOf = (s) =>
  (s || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

// Where a line's mapping starts: a spaced dash of any kind (—, –, -, --) followed by a "word:". A dash inside a
// name ("Guest-checkout") is not one.
const SEP = /\s+[—–-]{1,2}\s+(?=[A-Za-z]+\s*:)/;

/**
 * "specs: a, b; workstreams: x" → the lists under the keys it knows, and the parts it could not read.
 * @param {string} text
 * @param {string[]} known the keys it reads
 * @returns {{keys: Object<string, string[]>, unread: string[]}}
 */
function mappingOf(text, known) {
  /** @type {Object<string, string[]>} */
  const keys = {};
  const unread = [];
  for (const part of text.split(';').filter((p) => p.trim())) {
    const kv = part.match(/^\s*([A-Za-z]+)\s*:\s*(.*)$/);
    if (kv && known.includes(kv[1].toLowerCase())) keys[kv[1].toLowerCase()] = listOf(kv[2]);
    else unread.push(part.trim());
  }
  return { keys, unread };
}

/**
 * "- `id` Title — specs: a, b; workstreams: x" → a milestone. A part of the mapping that is not specs or
 * workstreams is named in `problem`; when nothing in it can be read, the text stays in the title so it is
 * still on screen.
 * @param {string} line
 * @returns {{milestone: Milestone, problem?: string|null}|null} null for a line with no `id`
 */
function milestoneOf(line) {
  const m = line.match(/^[-*]\s+`([^`]+)`\s+(.+)$/);
  if (!m) return null;
  const id = m[1].trim();
  const rest = m[2].trim();
  const sep = rest.match(SEP);
  if (!sep) return { milestone: { id, title: rest, specs: [], workstreams: [] } };
  const at = /** @type {number} */ (sep.index);
  const { keys, unread } = mappingOf(rest.slice(at + sep[0].length), ['specs', 'workstreams']);
  const read = Object.keys(keys).length > 0;
  return {
    milestone: {
      id,
      title: read ? rest.slice(0, at).trim() : rest,
      specs: keys.specs || [],
      workstreams: keys.workstreams || [],
    },
    problem: unread.length
      ? 'milestone `' +
        id +
        '` names something after its title that is not "specs:" or "workstreams:": "' +
        unread.join('; ') +
        '"'
      : null,
  };
}

/**
 * The Categories section: "Checkout, Billing" names categories that own nothing; "- Checkout — specs:
 * checkout-flow, cart-*" names one and the openspec capabilities it owns (`name-*` owns every capability starting
 * `name-`). A line ending in "." or ":" is a note about the list, not part of it. What cannot be read is pushed
 * onto `problems`: a mapping that is not "specs:" (the category is kept, owning nothing), several names before
 * one mapping or a category listed twice (left out), a spec two categories claim (the first keeps it).
 * @param {string[]} lines the section's lines
 * @param {string[]} problems
 * @returns {{categories: string[], categorySpecs: Object<string, string[]>}}
 */
function categoriesOf(lines, problems) {
  /** @type {string[]} */
  const categories = [];
  /** @type {Object<string, string[]>} */
  const categorySpecs = {};
  const owner = new Map();
  /** @type {(name: string, specs: string[]) => void} */
  const add = (name, specs) => {
    if (categories.includes(name)) {
      problems.push('category `' + name + '` is listed twice; the second was left out');
      return;
    }
    categories.push(name);
    categorySpecs[name] = specs.filter((s) => {
      if (!owner.has(s)) {
        owner.set(s, name);
        return true;
      }
      problems.push(
        'spec `' + s + '` is owned by both `' + owner.get(s) + '` and `' + name + '`; `' + owner.get(s) + '` keeps it'
      );
      return false;
    });
  };
  for (const l of lines) {
    const text = l.replace(/^[-*]\s+/, '').trim();
    const sep = text.match(SEP);
    if (!sep) {
      if (!/[.:]\s*$/.test(text)) for (const name of listOf(text)) add(name, []);
      continue;
    }
    const at = /** @type {number} */ (sep.index);
    const name = text.slice(0, at).trim();
    if (!name || name.includes(',')) {
      problems.push('a category line names more than one category before its specs and was left out: "' + text + '"');
      continue;
    }
    const { keys, unread } = mappingOf(text.slice(at + sep[0].length), ['specs']);
    if (unread.length)
      problems.push(
        'category `' + name + '` names something after it that is not "specs:": "' + unread.join('; ') + '"'
      );
    add(name, keys.specs || []);
  }
  return { categories, categorySpecs };
}

/**
 * @param {string|undefined} text MISSION.md contents
 * @returns {{title: string|null, statement: string|null, focus: string|null, milestones: Milestone[],
 *   categories: string[], categorySpecs: Object<string, string[]>, problems: string[]}} `categories` in the
 *   file's order; `categorySpecs` the specs each one owns; `problems` names everything that could not be read
 */
function parseMission(text) {
  const lines = String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  /** @type {string[]} */
  const problems = [];
  const h1 = lines.findIndex((l) => /^#\s/.test(l) || l.trim() === '#');
  /** @type {Object<string, string[]>} */
  const sections = {};
  /** @type {string[]} */
  const intro = [];
  /** @type {string|null} */
  let into = null;
  lines.forEach((l, i) => {
    const h2 = l.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      into = h2[1].toLowerCase();
      sections[into] = [];
      return;
    }
    if (i === h1) return;
    if (into) sections[into].push(l);
    else if (h1 >= 0 && i > h1) intro.push(l);
  });
  const title = h1 >= 0 ? lines[h1].replace(/^#\s*/, '').trim() || null : null;
  const statement = paragraphs(intro)[0] || null;
  if (!title) problems.push('no mission title: the file needs a "# " heading with the mission on it');
  if (!statement)
    problems.push('no mission statement: the first paragraph under the title says what the repo is trying to achieve');

  /** @type {Milestone[]} */
  const milestones = [];
  for (const l of sections.milestones || []) {
    if (!/^[-*]\s+/.test(l)) continue;
    const read = milestoneOf(l);
    if (!read) {
      problems.push('milestone line has no `id` and was left out: "' + l.replace(/^[-*]\s+/, '').trim() + '"');
      continue;
    }
    const m = read.milestone;
    if (milestones.some((x) => x.id === m.id)) {
      problems.push('milestone id `' + m.id + '` is used twice; the second ("' + m.title + '") was left out');
      continue;
    }
    if (read.problem) problems.push(read.problem);
    milestones.push(m);
  }
  const { categories, categorySpecs } = categoriesOf(sections.categories || [], problems);
  return {
    title,
    statement,
    focus: paragraphs(sections.focus || [])[0] || null,
    milestones,
    categories,
    categorySpecs,
    problems,
  };
}

const TEMPLATE = path.join(__dirname, '..', '..', 'templates', 'MISSION.md');

/**
 * The repo's mission as Flowwatch shows it: what the file says, where it was found (relative to
 * the repo, '/'-separated), and — only while there is no file — the template to start one from.
 * @param {string} repoRoot
 * @returns {ReturnType<typeof parseMission> & {file: string|null, template?: string|null}} parseMission's
 *   fields plus `file` (null when none) and `template` (only when none)
 */
function missionOf(repoRoot) {
  const found = findMissionFile(repoRoot);
  if (!found) {
    let template = null;
    try {
      template = fs.readFileSync(TEMPLATE, 'utf8');
    } catch {
      /* the page then shows the steps without it */
    }
    return { file: null, template, ...parseMission(''), title: null, statement: null, problems: [] };
  }
  const file = path.relative(repoRoot, found.path).split(path.sep).join('/');
  if (found.error)
    return {
      file,
      ...parseMission(''),
      title: null,
      statement: null,
      problems: [file + ' could not be read: ' + found.error],
    };
  return { file, ...parseMission(found.text) };
}

module.exports = { parseMission, findMissionFile, missionOf };
