// `flowwatch demo` builds into a temp folder; stopping the server removes it, so running the demo leaves
// nothing behind.
const fs = require('fs');
const path = require('path');
const { serveDemo } = require('../../../demo/serve');

test('the temp build is there while the demo runs and gone once it stops', async () => {
  const s = await serveDemo({ dataDir: path.join(__dirname, '..', '..', 'fixtures', 'demo'), port: 0 });
  expect(fs.existsSync(path.join(s.dir, 'index.html'))).toBe(true);
  await s.close();
  expect(fs.existsSync(s.dir)).toBe(false);
});
