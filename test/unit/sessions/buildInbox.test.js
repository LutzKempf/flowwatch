const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../../../server/db');
const { buildInbox } = require('../../../server/sessions/buildInbox');

const NOW = Date.parse('2026-09-14T12:00:00.000Z');

const say = (id, ts, text, extra = {}) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    message: { id, role: 'assistant', content: [{ type: 'text', text }] },
    ...extra,
  });

function fixtures({ extraRecords = [], extraTranscripts = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-'));
  const appDir = path.join(root, 'app');
  const txDir = path.join(root, 'projects', 'C--repo');
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(txDir, { recursive: true });
  fs.writeFileSync(
    path.join(appDir, 'local_1.json'),
    JSON.stringify({
      sessionId: 'local_1',
      cliSessionId: 'cli-1',
      cwd: 'C:/repo/.claude/worktrees/wtA',
      title: 'Retro: close the guard',
      branch: 'claude/wt-a',
      lastActivityAt: '2026-09-14T11:00:00.000Z',
      prs: [{ prNumber: 840, state: 'OPEN' }],
    })
  );
  fs.writeFileSync(
    path.join(appDir, 'local_2.json'),
    JSON.stringify({
      sessionId: 'local_2',
      cliSessionId: 'cli-2',
      cwd: 'C:/repo/.claude/worktrees/wtB',
      title: 'Fix the gift card cap',
      branch: 'claude/gift-card-cap',
      lastActivityAt: '2026-09-14T10:00:00.000Z',
    })
  );
  fs.writeFileSync(
    path.join(txDir, 'cli-1.jsonl'),
    say('m-a', '2026-09-14T11:00:00.000Z', 'Ready.\n\nShall I merge it?') + '\n'
  );
  fs.writeFileSync(
    path.join(txDir, 'cli-2.jsonl'),
    say('m-b', '2026-09-14T10:00:00.000Z', 'All done, nothing left.') + '\n'
  );
  for (const [name, body] of extraRecords) fs.writeFileSync(path.join(appDir, name), JSON.stringify(body));
  for (const [name, body] of extraTranscripts) fs.writeFileSync(path.join(txDir, name), body);
  return { appDir, projectsDir: path.join(root, 'projects') };
}

// The repo's categories, as MISSION.md gives them to the collector (a made-up shop's).
const CATS = ['Checkout', 'Payments', 'Reporting', 'Notifications', 'Billing', 'Retro', 'Architecture'];
const build = (db, extra = {}, fixtureOpts) =>
  buildInbox(db, {
    ...fixtures(fixtureOpts),
    repoRoot: 'C:/repo',
    now: NOW,
    inferCategory: () => null,
    categories: CATS,
    ...extra,
  });

test('items carry the board phase by worktree, and null when the board never saw it', () => {
  const db = openDb(':memory:');
  db.prepare('INSERT INTO sessions (id, worktree, current_phase, last_seen) VALUES (?,?,?,?)').run(
    'cli-1',
    'wtA',
    7,
    NOW
  );

  const { items } = build(db);
  const byId = Object.fromEntries(items.map((i) => [i.session_id, i]));

  expect(byId.local_1.phase).toBe(7);
  expect(byId.local_1.phase_from).toBe('board');
  expect(byId.local_2.phase).toBeNull();
  expect(byId.local_2.phase_from).toBeNull();
  db.close();
});

test('an item carries what the page needs for a row', () => {
  const db = openDb(':memory:');
  const { items, generated_at } = build(db);
  const item = items.find((i) => i.session_id === 'local_1');

  expect(generated_at).toBe(NOW);
  expect(item).toMatchObject({
    key: 'm-a',
    cli_session_id: 'cli-1',
    title: 'Retro: close the guard',
    branch: 'claude/wt-a',
    worktree: 'wtA',
    state: 'waiting',
    category: 'Retro',
    category_from: 'title prefix',
    asks: true,
    asks_from: 'question mark',
    hours_waiting: 1,
    api_error: false,
  });
  expect(item.last_ask).toBe('Shall I merge it?');
  expect(item.pr).toEqual({ status: 'open', numbers: [840] });
  db.close();
});

// The board's phase_stats are the only source of a session's work time and output tokens, and the
// row shows both. A session the board never saw has none — never a zero, which reads as measured.
test('an item carries the board totals, and none when the board never saw it', () => {
  const db = openDb(':memory:');
  db.prepare('INSERT INTO sessions (id, worktree, current_phase, last_seen) VALUES (?,?,?,?)').run(
    'cli-1',
    'wtA',
    7,
    NOW
  );
  const stat = db.prepare(
    'INSERT INTO phase_stats (session_id, phase, work_ms, wait_ms, inputs, tokens) VALUES (?,?,?,?,?,?)'
  );
  stat.run('cli-1', 5, 60000, 120000, 2, 1500);
  stat.run('cli-1', 7, 30000, 0, 1, 500);

  const { items } = build(db);
  const byId = Object.fromEntries(items.map((i) => [i.session_id, i]));

  expect(byId.local_1.totals).toEqual({ work_ms: 90000, wait_ms: 120000, inputs: 3, tokens: 2000 });
  expect(byId.local_2.totals).toBeNull();
  db.close();
});

// A session whose last turn errored is stopped, not busy: dropping it as "still working" would hide
// it for the whole staleness window, and a broken session is exactly what the operator must see.
test('a session whose last turn errored is listed even while it is fresh', () => {
  const db = openDb(':memory:');
  const errored =
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-09-14T11:55:00.000Z',
      isApiErrorMessage: true,
      message: { id: 'm-err', role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] },
    }) + '\n';
  const { items } = build(
    db,
    {},
    {
      extraRecords: [
        [
          'local_3.json',
          {
            sessionId: 'local_3',
            cliSessionId: 'cli-3',
            cwd: 'C:/repo/.claude/worktrees/wtC',
            title: 'Reporting: keep writing',
            branch: 'claude/wt-c',
            lastActivityAt: '2026-09-14T11:55:00.000Z',
          },
        ],
      ],
      extraTranscripts: [['cli-3.jsonl', errored]],
    }
  );

  const item = items.find((i) => i.session_id === 'local_3');
  expect(item).toBeDefined();
  expect(item.api_error).toBe(true);
  db.close();
});

// The app records its own failures separately from the API's; a session broken that way is just as
// stopped, and the page groups on both.
test('a session the app recorded an error for is listed too', () => {
  const db = openDb(':memory:');
  const busy =
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-09-14T11:55:00.000Z',
      message: { id: 'm-app', role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] },
    }) + '\n';
  const { items } = build(
    db,
    {},
    {
      extraRecords: [
        [
          'local_5.json',
          {
            sessionId: 'local_5',
            cliSessionId: 'cli-5',
            cwd: 'C:/repo/.claude/worktrees/wtE',
            title: 'Billing: broke',
            branch: 'claude/wt-e',
            lastActivityAt: '2026-09-14T11:55:00.000Z',
            error: 'session crashed',
          },
        ],
      ],
      extraTranscripts: [['cli-5.jsonl', busy]],
    }
  );

  const item = items.find((i) => i.session_id === 'local_5');
  expect(item).toBeDefined();
  expect(item.app_error).toBe(true);
  db.close();
});

test('a session still working normally is left out, and the list is newest first', () => {
  const db = openDb(':memory:');
  const busy =
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-09-14T11:55:00.000Z',
      message: { id: 'm-busy', role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] },
    }) + '\n';
  const { items } = build(
    db,
    {},
    {
      extraRecords: [
        [
          'local_4.json',
          {
            sessionId: 'local_4',
            cliSessionId: 'cli-4',
            cwd: 'C:/repo/.claude/worktrees/wtD',
            title: 'Billing: still going',
            branch: 'claude/wt-d',
            lastActivityAt: '2026-09-14T11:55:00.000Z',
          },
        ],
      ],
      extraTranscripts: [['cli-4.jsonl', busy]],
    }
  );

  expect(items.map((i) => i.session_id)).toEqual(['local_1', 'local_2']);
  db.close();
});

test('a category with no title prefix falls back to inference, then to none', () => {
  const db = openDb(':memory:');
  const inferred = build(db, { inferCategory: () => 'Notifications' }).items.find((i) => i.session_id === 'local_2');
  expect(inferred.category).toBe('Notifications');
  expect(inferred.category_from).toBe('inferred');

  const none = build(db).items.find((i) => i.session_id === 'local_2');
  expect(none.category).toBeNull();
  expect(none.category_from).toBeNull();
  db.close();
});

test('a session quiet for longer than the window is left out', () => {
  const db = openDb(':memory:');
  expect(build(db, { windowDays: 0.5 }).items.map((i) => i.session_id)).toEqual(['local_1', 'local_2']);
  expect(build(db, { windowDays: 0.01 }).items).toHaveLength(0);
  db.close();
});

// Worktrees are reused between sessions in this repo, so the fallback join must take the newest row
// and say it matched that way; otherwise a recycled worktree shows a previous session's phase.
test('a phase matched only by worktree takes the newest row and says so', () => {
  const db = openDb(':memory:');
  const ins = db.prepare('INSERT INTO sessions (id, worktree, current_phase, last_seen) VALUES (?,?,?,?)');
  ins.run('cli-old', 'wtA', 3, NOW - 24 * 3600 * 1000);
  ins.run('cli-new', 'wtA', 9, NOW - 3600 * 1000);

  const item = build(db).items.find((i) => i.session_id === 'local_1');
  expect(item.phase).toBe(9);
  expect(item.phase_from).toBe('board by worktree');
  db.close();
});

// An empty list because a source could not be read is not "nothing is waiting on you".
test('an unreadable source says so instead of looking empty', () => {
  const db = openDb(':memory:');
  const out = buildInbox(db, {
    appDir: path.join(os.tmpdir(), 'missing-app-' + Date.now()),
    projectsDir: path.join(os.tmpdir(), 'missing-tx-' + Date.now()),
    repoRoot: 'C:/repo',
    now: NOW,
    inferCategory: () => null,
  });
  expect(out.items).toHaveLength(0);
  expect(out.sources).toEqual({ app_records: 'unreadable', transcripts: 'unreadable' });
  db.close();
});

test('readable sources are reported as ok', () => {
  const db = openDb(':memory:');
  expect(build(db).sources).toEqual({ app_records: 'ok', transcripts: 'ok' });
  db.close();
});

// The page says, in one line, that the board runs on the hooks alone when the app's records folder is not there,
// and where it looked: the caller says where (appRecordsDir), the walk says whether it was there.
test("the payload says whether the app's records folder was found, and where it looked", () => {
  const db = openDb(':memory:');
  const missing = path.join(os.tmpdir(), 'missing-app-' + Date.now());
  expect(
    buildInbox(db, {
      appDir: missing,
      appLooked: 'looked in ' + missing,
      projectsDir: missing,
      repoRoot: 'C:/repo',
      now: NOW,
    }).records_folder
  ).toEqual({ found: false, looked: 'looked in ' + missing });
  expect(
    buildInbox(db, {
      appDir: null,
      appLooked: 'there is no Claude desktop app for Linux',
      projectsDir: missing,
      repoRoot: 'C:/repo',
      now: NOW,
    }).records_folder
  ).toEqual({ found: false, looked: 'there is no Claude desktop app for Linux' });
  expect(build(db).records_folder).toEqual({ found: true, looked: expect.stringMatching(/^looked in /) });
  db.close();
});
