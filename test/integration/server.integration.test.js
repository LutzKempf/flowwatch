const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer } = require('../../server/server');

// Every startServer call gets an ISOLATED temp logDir — otherwise the default
// ~/.flowwatch/logs replay runs as a side effect and rotates REAL operator
// logs during npm test.
function tmpLogDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'devpipe-srv-'));
}

test('starts on an ephemeral port; a second bind on the same port rejects (single-instance)', async () => {
  const a = await startServer({ port: 0, dbPath: ':memory:', logDir: tmpLogDir() });
  const used = a.port;
  await expect(startServer({ port: used, dbPath: ':memory:', logDir: tmpLogDir() })).rejects.toThrow(
    /EADDRINUSE|in use/i
  );
  await a.close();
});

test('FLOWWATCH_PORT=0 is honored as an ephemeral-port request (not the 4477 default)', async () => {
  const prev = process.env.FLOWWATCH_PORT;
  process.env.FLOWWATCH_PORT = '0';
  try {
    const s = await startServer({ dbPath: ':memory:', logDir: tmpLogDir() });
    expect(s.port).toBeGreaterThan(0);
    expect(s.port).not.toBe(4477);
    await s.close();
  } finally {
    if (prev === undefined) delete process.env.FLOWWATCH_PORT;
    else process.env.FLOWWATCH_PORT = prev;
  }
});

test('a set-but-empty or garbage FLOWWATCH_PORT is treated as unset', async () => {
  // NOTE: we assert the envPort() helper directly rather than booting with no opts.port —
  // the fallback there is the REAL 4477, which may be a live collector on this machine.
  // Booting with port:0 instead would bypass the very code path under test.
  const { envPort } = require('../../server/server');
  const prev = process.env.FLOWWATCH_PORT;
  try {
    for (const bad of ['', '  ', 'abc', '-1']) {
      process.env.FLOWWATCH_PORT = bad;
      expect(envPort()).toBeUndefined(); // unset → startServer's 4477 default applies
    }
    process.env.FLOWWATCH_PORT = '0';
    expect(envPort()).toBe(0); // explicit 0 (ephemeral) still honored
    process.env.FLOWWATCH_PORT = '5123';
    expect(envPort()).toBe(5123);
  } finally {
    if (prev === undefined) delete process.env.FLOWWATCH_PORT;
    else process.env.FLOWWATCH_PORT = prev;
  }
});
