// A repo feeds a panel through its flowwatch.json: a command run without a shell, or a file. Every way that
// can go wrong is a state the panel shows with its reason, never an empty panel that reads as "nothing to
// report", and a feed never blocks the collector.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readFeed } = require('../../../server/feeds');
const { readWiring } = require('../../../server/repo/settings');

const repoWith = (settings, files = {}) => {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-feed-'));
  if (settings !== undefined)
    fs.writeFileSync(
      path.join(r, 'flowwatch.json'),
      typeof settings === 'string' ? settings : JSON.stringify(settings)
    );
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(r, rel)), { recursive: true });
    fs.writeFileSync(path.join(r, rel), text);
  }
  return r;
};
const script = (body) => ({ 'feed.js': body });
const noProblems = () => [];
const read = (r, check = noProblems, opts) => readFeed(r, readWiring(r), 'value', check, opts);

test('no entry is "not set up"; false is "off"', async () => {
  expect(await read(repoWith(undefined))).toEqual({ state: 'not-set-up' });
  expect(await read(repoWith({ value: false }))).toEqual({ state: 'off' });
});

test('a flowwatch.json that is not valid JSON is an error with the parse reason', async () => {
  const out = await read(repoWith('{ "value": '));
  expect(out).toMatchObject({ state: 'error', reason: expect.stringMatching(/^flowwatch\.json is not valid JSON: /) });
});

test('a command that prints the format gives data, run in the repo', async () => {
  const r = repoWith(
    { value: { command: ['node', 'feed.js'] } },
    script('console.log(JSON.stringify({ format: 1, cwd: process.cwd() }))')
  );
  const out = await read(r);
  expect(out.state).toBe('data');
  expect(path.resolve(out.data.cwd).toLowerCase()).toBe(path.resolve(r).toLowerCase());
});

test('a file gives data; a file that is not there is an error naming it', async () => {
  const r = repoWith({ value: { file: 'data/value.json' } }, { 'data/value.json': '{"format":1,"x":2}' });
  expect(await read(r)).toEqual({ state: 'data', data: { format: 1, x: 2 } });
  const missing = repoWith({ value: { file: 'data/none.json' } });
  expect(await read(missing)).toMatchObject({ state: 'error', reason: expect.stringContaining('data/none.json') });
});

test('an entry with neither, or both, of command and file is an error saying what it needs', async () => {
  for (const entry of [
    {},
    { command: 'node feed.js' },
    { command: [] },
    { file: '' },
    { command: ['node', 'a.js'], file: 'b.json' },
  ]) {
    const out = await read(repoWith({ value: entry }));
    expect(out).toMatchObject({ state: 'error', reason: expect.stringMatching(/"command".*"file"/) });
  }
});

test('output that is not JSON, or a format other than 1, is an error saying so', async () => {
  const notJson = repoWith({ value: { command: ['node', 'feed.js'] } }, script('console.log("hello")'));
  expect(await read(notJson)).toMatchObject({ state: 'error', reason: expect.stringMatching(/not JSON/) });
  const v2 = repoWith(
    { value: { command: ['node', 'feed.js'] } },
    script('console.log(JSON.stringify({ format: 2 }))')
  );
  expect(await read(v2)).toMatchObject({ state: 'error', reason: expect.stringMatching(/format 2.*format 1/) });
  const none = repoWith({ value: { file: 'v.json' } }, { 'v.json': '{"figures":[]}' });
  expect(await read(none)).toMatchObject({ state: 'error', reason: expect.stringMatching(/no format/) });
});

test("the panel check's problems are the error, naming the first of them", async () => {
  const r = repoWith({ value: { file: 'v.json' } }, { 'v.json': '{"format":1}' });
  const out = await read(r, () => ['figures is missing', 'b', 'c', 'd']);
  expect(out).toEqual({
    state: 'error',
    reason: 'value does not match its format: figures is missing; b; c (and 1 more)',
  });
});

test('a command that fails is an error with its exit code and first error line', async () => {
  const r = repoWith(
    { value: { command: ['node', 'feed.js'] } },
    script('console.error("\\nledger database is locked\\nat line 2"); process.exit(3)')
  );
  const out = await read(r);
  expect(out).toEqual({ state: 'error', reason: 'value: its command exited with code 3: ledger database is locked' });
});

test('a command that cannot start is an error, not a crash', async () => {
  const r = repoWith({ value: { command: ['no-such-program-flowwatch', '--json'] } });
  expect(await read(r)).toMatchObject({
    state: 'error',
    reason: expect.stringMatching(/^value: its command could not start/),
  });
});

test('a command that runs past the limit is stopped and reported', async () => {
  const r = repoWith({ value: { command: ['node', 'feed.js'] } }, script('setTimeout(() => {}, 10000)'));
  const started = Date.now();
  const out = await read(r, noProblems, { timeoutMs: 300 });
  expect(out).toEqual({ state: 'error', reason: 'value: its command ran longer than 0.3 s and was stopped' });
  expect(Date.now() - started).toBeLessThan(5000);
});

test('arguments reach the command as they are: no shell reads them', async () => {
  const r = repoWith(
    { value: { command: ['node', 'feed.js', 'a && echo injected', '$HOME', '|x'] } },
    script('console.log(JSON.stringify({ format: 1, args: process.argv.slice(2) }))')
  );
  const out = await read(r);
  expect(out.data.args).toEqual(['a && echo injected', '$HOME', '|x']);
});

test('the collector keeps answering while a feed runs', async () => {
  const r = repoWith(
    { value: { command: ['node', 'feed.js'] } },
    script('setTimeout(() => console.log(JSON.stringify({ format: 1 })), 400)')
  );
  let ticks = 0;
  const timer = setInterval(() => ticks++, 20);
  try {
    expect((await read(r)).state).toBe('data');
  } finally {
    clearInterval(timer);
  }
  expect(ticks).toBeGreaterThan(5); // the event loop ran while the command did
});
