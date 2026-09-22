# Security

Flowwatch is a single-user tool that runs on your own machine.

- **It listens on `127.0.0.1` only**, and has no authentication: anyone who can use the machine can read the
  dashboard and post events to it.
- **It makes no network calls beyond `127.0.0.1`.** The session hooks post to the local collector,
  `npx flowwatch check` asks it one question, the pages read only their own collector's `/api`, and the demo's
  snapshot tool (`demo/snapshot.js`) reads only the collector address it is given.
- **It runs repo commands without a shell.** Git, and the feed commands named in the repo's `flowwatch.json`, run
  with their arguments passed as they are. Those commands, and the `sessions.categorize` module it loads, are the
  repo's own code and run as you: treat `flowwatch.json` like any script in the repo.
- **It reads the Claude app's session records and Claude Code's transcripts read-only.** It writes only its own
  database and logs (`~/.flowwatch`, or the folder `flowwatch.json` names), the temporary site `npx flowwatch demo`
  serves and removes on exit, and, when you run `npx flowwatch install-hooks`, the repo's `.claude/settings.json`.

To report a vulnerability, use "Report a vulnerability" on the repository's Security tab on GitHub.
