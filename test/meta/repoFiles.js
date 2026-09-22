// The files a reader of the published repo sees: the tracked ones, plus new files git would pick up
// (untracked and not ignored), so the checks see a file before it is committed. A tracked file that
// has been deleted or moved on disk is left out.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');

/** @returns {string[]} repo-relative paths with forward slashes, sorted */
function repoFiles() {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const files = new Set(out.split('\0').filter(Boolean));
  return [...files].filter((f) => fs.existsSync(path.join(ROOT, f))).sort();
}

/**
 * Every line of every repo text file, for the content checks. A file with a zero byte in its first 8,000 is
 * binary (git's own test): an image's compressed bytes are not text, and read as text they match at random.
 * @param {(file: string) => boolean} [keep] which files to read
 * @returns {{file: string, line: number, text: string}[]}
 */
function repoLines(keep = () => true) {
  const lines = [];
  for (const file of repoFiles().filter(keep)) {
    const bytes = fs.readFileSync(path.join(ROOT, file));
    if (bytes.subarray(0, 8000).includes(0)) continue;
    bytes
      .toString('utf8')
      .split(/\r?\n/)
      .forEach((text, i) => lines.push({ file, line: i + 1, text }));
  }
  return lines;
}

/**
 * The lines that match any of the named patterns, as "file:line: name" so a failure reads as a to-do list.
 * @param {{file: string, line: number, text: string}[]} lines
 * @param {Object<string, RegExp>} patterns
 * @returns {string[]}
 */
function findings(lines, patterns) {
  const out = [];
  for (const { file, line, text } of lines) {
    for (const [name, re] of Object.entries(patterns)) {
      if (re.test(text)) out.push(`${file}:${line}: ${name}`);
    }
  }
  return out;
}

module.exports = { ROOT, repoFiles, repoLines, findings };
