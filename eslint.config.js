const fs = require('fs');
const path = require('path');
const js = require('@eslint/js');
const globals = require('globals');

// web/lib/render.js is a classic script: the functions and constants it declares at the top level are
// globals the pages call.
const renderGlobals = Object.fromEntries(
  [
    ...fs.readFileSync(path.join(__dirname, 'web', 'lib', 'render.js'), 'utf8').matchAll(/^(?:function|const) (\w+)/gm),
  ].map((m) => [m[1], 'readonly'])
);

module.exports = [
  { ignores: ['coverage/', 'demo/site/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: globals.node },
    rules: {
      // Destructuring a key out beside a rest copy is how the code drops a field from an object.
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
  },
  {
    files: ['web/lib/*.js'],
    languageOptions: {
      sourceType: 'script',
      // `module` is there only when the tests require() the script; `Data` is data.js's global.
      globals: { ...globals.browser, module: 'readonly', Data: 'readonly' },
    },
    rules: {
      // A classic script's top-level names are the page's globals, used from the other scripts.
      'no-unused-vars': ['error', { vars: 'local', ignoreRestSiblings: true }],
    },
  },
  {
    // Each page's own modules. They import one another; web/lib/'s classic scripts reach them as globals.
    files: ['web/pages/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.browser, ...renderGlobals, Data: 'readonly', Nav: 'readonly', Triage: 'readonly' },
    },
  },
];
