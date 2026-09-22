# Contributing

```bash
npm install
npm run check
```

`npm run check` runs everything a change has to pass: ESLint, the Prettier check, the type check (`tsc --checkJs`
over the JSDoc types) and the whole Jest suite. `npm run format` fixes the formatting.

`npm run test:browser` runs the browser tier in `test/browser/`: the pages in Chromium, live and as the demo, with an
accessibility scan of every panel. It needs Chromium once: `npx playwright install chromium`.

- **Test first.** A change starts with a test that fails without it, in `test/unit/` (in-process) or
  `test/integration/` (a real collector over HTTP). A fix's test says in its name what went wrong.
- **Small files, one job each.** Server code is plain CommonJS. `web/lib/` holds plain browser scripts both pages
  share; each page's own code is ES modules in `web/pages/<page>/`, loaded by the browser as they are.
- **No build step.** What is in the repo is what runs: no bundler, no transpiler, no generated code.
- **Comments say why.** State the reason in its own words; the code already says what it does.
