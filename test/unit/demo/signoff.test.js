// The sign-off (demo/signoff.js): the demo publishes a snapshot of real dashboards, so the build takes only data a
// person has read and signed. The signature is a hash of exactly the files the build publishes.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { hashData, verify, DATA_FILES } = require('../../../demo/signoff');
const { ENDPOINTS } = require('../../../web/lib/data');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fw-signoff-'));
function snapshotDir(order = DATA_FILES, body = (f) => JSON.stringify({ file: f })) {
  const dir = tmp();
  for (const f of order) fs.writeFileSync(path.join(dir, f), body(f));
  return dir;
}

test('the data files are one per endpoint the pages read, plus meta.json', () => {
  expect([...DATA_FILES].sort()).toEqual([...ENDPOINTS.map((n) => n + '.json'), 'meta.json'].sort());
});

test('the hash does not depend on the order the files were written or listed in', () => {
  const a = snapshotDir(DATA_FILES);
  const b = snapshotDir([...DATA_FILES].reverse());
  expect(hashData(a)).toMatch(/^[0-9a-f]{64}$/);
  expect(hashData(b)).toBe(hashData(a));
});

test('one changed byte changes the hash', () => {
  const dir = snapshotDir();
  const before = hashData(dir);
  const file = path.join(dir, 'pipeline.json');
  const bytes = fs.readFileSync(file);
  bytes[3] ^= 1;
  fs.writeFileSync(file, bytes);
  expect(hashData(dir)).not.toBe(before);
});

test('bytes moved from one file to the next change it: every file is hashed with its name and length', () => {
  // gates.json and inbox.json sort next to each other: "ab" + "c" and "a" + "bc" are the same bytes run together.
  const split = (cut) =>
    snapshotDir(DATA_FILES, (f) =>
      f === 'gates.json' ? 'abc'.slice(0, cut) : f === 'inbox.json' ? 'abc'.slice(cut) : '{}'
    );
  expect(hashData(split(2))).not.toBe(hashData(split(1)));
});

test('a file that is not one of the data files is neither hashed nor, so, signed', () => {
  const dir = snapshotDir();
  const before = hashData(dir);
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'raw, uncleaned');
  expect(hashData(dir)).toBe(before);
});

test('signed data passes, whatever whitespace surrounds the hash in SIGNOFF', () => {
  const dir = snapshotDir();
  fs.writeFileSync(path.join(dir, 'SIGNOFF'), hashData(dir) + '\n');
  expect(verify(dir)).toEqual({ ok: true, hash: hashData(dir) });
});

test('data with no SIGNOFF is refused, and the message says what to do', () => {
  const dir = snapshotDir();
  const r = verify(dir);
  expect(r.ok).toBe(false);
  expect(r.message).toMatch(/no matching sign-off/);
  expect(r.message).toContain('no SIGNOFF file');
  expect(r.message).toContain(hashData(dir));
});

test('data changed after it was signed is refused', () => {
  const dir = snapshotDir();
  const signed = hashData(dir);
  fs.writeFileSync(path.join(dir, 'SIGNOFF'), signed);
  fs.appendFileSync(path.join(dir, 'inbox.json'), ' ');
  const r = verify(dir);
  expect(r.ok).toBe(false);
  expect(r.message).toMatch(/no matching sign-off/);
  expect(r.message).toContain('SIGNOFF holds ' + signed);
});

test('a folder missing a data file is refused, naming what is missing', () => {
  const dir = snapshotDir(DATA_FILES.filter((f) => f !== 'setup.json'));
  const r = verify(dir);
  expect(r.ok).toBe(false);
  expect(r.message).toMatch(/is missing setup\.json/);
});
