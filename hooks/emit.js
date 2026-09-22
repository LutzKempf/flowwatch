#!/usr/bin/env node
const { buildEvent, emit } = require('./lib/pipelineEmit');
const { mapHookEvent } = require('./lib/mapHookEvent');
const { commitTouchesCode } = require('./lib/resolvers');

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let hook;
  try {
    hook = JSON.parse(raw);
  } catch {
    process.exit(0); // never break the session
  }
  try {
    for (const partial of mapHookEvent(hook)) {
      if (partial.type === 'commit') partial.touchesCode = commitTouchesCode({ cwd: hook.cwd });
      emit(buildEvent(partial));
    }
  } catch {
    /* fail open: a hook never breaks the session */
  }
  // No process.exit(0) here: it would end the process before the fire-and-forget POST's socket
  // flushes. The POST's 500 ms socket timeout bounds the natural exit, and the exit code is 0 either way.
  process.exitCode = 0;
});
