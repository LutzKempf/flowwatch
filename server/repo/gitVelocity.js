const { execFileSync } = require('child_process');

/**
 * Today's date in the LOCAL zone as 'YYYY-MM-DD'. git --date=short emits author
 * local dates, so the trailing-window anchor must be local too.
 * @returns {string}
 */
function localToday() {
  const d = new Date();
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * ISO-8601 week label for a calendar date.
 * @param {string} dateStr 'YYYY-MM-DD'
 * @returns {string} 'YYYY-Www' (ISO week-numbering year + zero-padded week)
 */
function isoWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 + Math.round(((d.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * PR velocity from git-log lines. Counts only PR-bearing commits (subject has (#NNN)).
 *
 * `trailing7d` exists because `perWeek`'s newest bucket is a PARTIAL ISO week for
 * six days out of seven. Shown as "PRs / week", it would drop sharply every Monday —
 * both counts correct, the rate wrong. A trailing window is always a whole window,
 * so it never swings on a calendar boundary. `perWeek` is kept for the history it genuinely describes.
 * @param {string[]} lines "YYYY-MM-DD<TAB>subject" lines (any order; git log is newest-first)
 * @param {string} [today] 'YYYY-MM-DD' anchor for the trailing window (default: now, UTC)
 * @returns {{totalPRs: number, perWeek: Object<string, number>, trailing7d: number}}
 *   perWeek keys ascending (oldest→newest)
 */
function velocityFromLog(lines, today) {
  /** @type {Object<string, number>} */
  const counts = {};
  let totalPRs = 0;
  let trailing7d = 0;
  // The anchor is the LOCAL date, not the UTC one, because git's `--date=short`
  // emits the author's local date. Anchoring in UTC made a commit authored after
  // local midnight in a UTC+ zone look like tomorrow, and `age >= 0` dropped it.
  const anchor = Date.parse((today || localToday()) + 'T00:00:00Z');
  // Strictly less than 7 days: the dates are day-granular, so `<= 7 days` spans
  // D-7..D — eight calendar days under a tile that says seven.
  const WINDOW_MS = 7 * 86400000;
  for (const line of lines) {
    const [date, subject = ''] = line.split('\t');
    if (!/\(#\d+\)/.test(subject)) continue;
    totalPRs++;
    const w = isoWeek(date);
    counts[w] = (counts[w] || 0) + 1;
    const age = anchor - Date.parse(date + 'T00:00:00Z');
    if (age >= 0 && age < WINDOW_MS) trailing7d++;
  }
  // Keys ascending (oldest→newest): git log emits newest-first, and consumers read
  // "latest week" via Object.keys(perWeek).slice(-1) — insertion order must not leak.
  /** @type {Object<string, number>} */
  const perWeek = {};
  for (const w of Object.keys(counts).sort()) perWeek[w] = counts[w];
  return { totalPRs, perWeek, trailing7d };
}

/** @type {Set<string>} */
const WARNED = new Set();

/**
 * PR velocity for a repo, shelling out to `git log --since`. FAIL-SOFT: a git
 * failure (not a repo, git missing, transient lock) degrades to an empty
 * velocity with a warning — one broken tile must never fail the whole
 * mission payload. The warning is printed once per folder: the pages refresh every few seconds, and the same
 * failure repeated on each refresh would bury the rest of the log.
 * @param {string} repoDir repo root to run git in
 * @param {string} [since='8 weeks ago'] git --since expression
 * @param {Set<string>} [warned] folders already warned about (tests pass their own)
 * @returns {{totalPRs: number, perWeek: Object<string, number>, trailing7d: number}}
 */
function velocityFromRepo(repoDir, since = '8 weeks ago', warned = WARNED) {
  try {
    const out = execFileSync(
      'git',
      ['-C', repoDir, 'log', `--since=${since}`, '--pretty=format:%ad%x09%s', '--date=short'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return velocityFromLog(out.split(/\r?\n/).filter(Boolean));
  } catch (e) {
    if (!warned.has(repoDir)) {
      warned.add(repoDir);
      const first = /** @type {Error} */ (e).message.split('\n')[0];
      console.warn('[flowwatch] merged work is not counted (git log failed):', first);
    }
    return { totalPRs: 0, perWeek: {}, trailing7d: 0 };
  }
}

module.exports = { velocityFromLog, velocityFromRepo, isoWeek, localToday };
