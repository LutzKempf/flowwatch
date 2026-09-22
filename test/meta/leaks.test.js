// Nothing personal or secret in a repo meant to be read by anyone: no email address, no home-folder
// path that names a machine's user, no wallet-shaped address, no credential. The patterns are
// written so this file does not match itself.
const { repoLines, findings } = require('./repoFiles');

const PATTERNS = {
  'email address': /[\w.%+-]+@[a-z\d-]+(\.[a-z\d-]+)*\.[a-z]{2,}\b/i,
  'Windows home folder': /\b[a-z]:(\\{1,2}|\/)Users(\\{1,2}|\/)\w/i,
  'macOS or Linux home folder': /(^|[^\w.])\/(Users|home)\/\w/,
  '0x address': /\b0x[\da-f]{40}\b/i,
  'GitHub token': /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z\d]{20,}|\bgithub_pat_\w{20,}/,
  'API key': /\bsk-[\w-]{20,}/,
  'AWS access key': /\bAKIA[\dA-Z]{16}\b/,
  'private key': new RegExp('-{5}BEGIN [A-Z ]*PRIVATE KEY-{5}'),
};

// package-lock.json is npm's registry metadata as published, and a package author's deprecation notice in it
// carries a contact address. It is not ours to edit, so only that one pattern is skipped there.
const THIRD_PARTY = { 'package-lock.json': ['email address'] };

test('no file holds an email address, a home-folder path, an address or a credential', () => {
  const found = findings(repoLines(), PATTERNS).filter((f) => {
    const [where, name] = f.split(': ');
    return !(THIRD_PARTY[where.slice(0, where.lastIndexOf(':'))] || []).includes(name);
  });
  expect(found).toEqual([]);
});

test('the patterns catch what they are for', () => {
  const hits = (text) => findings([{ file: 'x', line: 1, text }], PATTERNS).length;
  // Joined at run time, so the samples are not themselves findings in this file.
  const j = (...parts) => parts.join('');
  for (const bad of [
    j('mail me at someone', '@', 'example.org'),
    j('C:', '\\Users\\someone\\repo'),
    j('"C:', '\\\\Users\\\\someone"'),
    j('cd /', 'Users/someone/repo'),
    j('at /', 'home/someone'),
    '0x' + 'ab'.repeat(20),
    'ghp_' + 'a'.repeat(36),
    'github_pat_' + 'a'.repeat(30),
    'sk-' + 'a'.repeat(30),
    'AKIA' + 'A'.repeat(16),
    j('-----BEGIN RSA ', 'PRIVATE KEY-----'),
  ]) {
    expect([bad, hits(bad)]).toEqual([bad, 1]);
  }
  for (const fine of ['risk-free task-list', 'node_modules/@eslint/js', 'https://example.org/homepage', '0x1f']) {
    expect([fine, hits(fine)]).toEqual([fine, 0]);
  }
});
