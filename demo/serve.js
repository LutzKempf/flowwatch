// `flowwatch demo`: builds the demo into a fresh temp folder and serves it the way GitHub Pages will, as plain files
// under /flowwatch/ with no API and no page routes, so what works here works there.
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build, BASE } = require('./build');

/**
 * @param {{dataDir: string, port?: number}} opts port 0 picks a free one
 * @returns {Promise<{url: string, dir: string, close: () => Promise<void>}>} `dir` is the temp build, removed on close
 */
async function serveDemo({ dataDir, port = 4478 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowwatch-demo-'));
  const remove = () => fs.rmSync(dir, { recursive: true, force: true });
  process.once('exit', remove); // `flowwatch demo` turns Ctrl-C into an exit, so this runs then too
  build({ dataDir, outDir: dir });
  const app = express();
  app.use(BASE, express.static(dir));
  // Like GitHub Pages: an address the site has no file for gets its 404 page, with the 404 status.
  app.use(BASE, (_req, res) => res.status(404).sendFile(path.join(dir, '404.html')));
  app.get('/', (_req, res) => res.redirect(BASE));
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1'); // localhost only, like the collector
    server.once('error', reject);
    server.once('listening', () =>
      resolve({
        url: 'http://127.0.0.1:' + /** @type {import('net').AddressInfo} */ (server.address()).port + BASE,
        dir,
        close: () =>
          new Promise((r) =>
            server.close(() => {
              remove();
              r();
            })
          ),
      })
    );
  });
}

module.exports = { serveDemo };
