# Settings: flowwatch.json

`flowwatch.json` is where a repo tells Flowwatch what only it knows: where its panels' data comes from, where its
collector runs, and how its sessions are sorted and cleaned up. It lives at the repo root, or in `docs/`. It is
optional, and so is every key in it: a key left out means "not set up", never a guess. The file is read again on
every refresh, so an edit shows without a restart, except `collector`, which is read when the collector starts.

A file that is not valid JSON, or cannot be read, is named by the setup check (`npx flowwatch check`, and the banner
on the pages), and nothing in it is used until it is fixed: it may be the file that turns a panel off.

The repo's mission, milestones and session categories are not here: they are in its `MISSION.md` (see
[SETUP.md](../SETUP.md), step 3). A category may own openspec specs there, one per line:
`- Checkout — specs: checkout-flow, cart-*`.

## The four feeds: `value`, `stages`, `ideas`, `gates`

Each of the four repo-fed panels has an entry naming a command to run or a file to read, or `false` to turn the
panel off. Their formats, and what each panel shows when a feed is missing or wrong, are in
[formats.md](formats.md).

```json
{
  "value": { "command": ["node", "scripts/flowwatch/value.js"] },
  "stages": { "file": "docs/flowwatch/stages.json" },
  "ideas": false,
  "gates": { "command": ["node", "scripts/gates.js", "--json"] }
}
```

## `openspec`

Where the repo keeps its openspec specs and changes, for the Specs panel, the spec counts, the lane cards and the
Cleanup stories. Without the key, `openspec/specs` and `openspec/changes`. `false` turns all of it off, for a repo
that does not use openspec.

```json
{ "openspec": { "specs": "spec/features", "changes": "spec/changes" } }
```

## `collector`

The port the repo's collector listens on (on `127.0.0.1` only), and the folder that holds its database and session
logs, relative to the repo (`~` is the home folder). The session hooks read the same entry, so a second repo on one machine never posts to,
or logs into, the first one's. Without it: port 4477 and `~/.flowwatch`. `FLOWWATCH_PORT` and `FLOWWATCH_DATA_DIR`
in the environment win over the file. Add the data folder to the repo's `.gitignore`.

```json
{ "collector": { "port": 4479, "dataDir": ".flowwatch-data" } }
```

## `sessions.categorize`

A module in the repo, exporting `inferCategory(branch, title)`, that returns the category of a session whose title
does not start with one (`Checkout: fix the total`), or `null`. It also files the specs and changes that no category
in `MISSION.md` owns, called with the capability's name. Without it, categories come from session titles only. A
module that is not there, does not load, or does not export `inferCategory` is named by the setup check under
"Session categories"; its sessions are then uncategorised, and nothing else stops.

```json
{ "sessions": { "categorize": "scripts/categorize.js" } }
```

```js
// scripts/categorize.js
module.exports = {
  inferCategory(branch, title) {
    const text = [branch, title].filter(Boolean).join(' ').toLowerCase();
    return /checkout|cart/.test(text) ? 'Checkout' : null;
  },
};
```

## `sessions.appRecords`

The folder where the Claude desktop app keeps its session records: the source of session titles and of which
sessions wait on you. Without it, `%APPDATA%\Claude\claude-code-sessions` on Windows and
`~/Library/Application Support/Claude/claude-code-sessions` on macOS. Linux has no Claude desktop app: there, and
wherever the folder is not found, the Sessions board runs on the session hooks alone and says so, with where it
looked. A relative path is the repo's; `~` is the home folder. In this folder and the data folder, `/` and `\` both work on every platform.

```json
{ "sessions": { "appRecords": "~/claude-app/claude-code-sessions" } }
```

## `cleanup.skill`

The Claude Code skill that closes what you pick in the Sessions board's Cleanup view. "Close selected…" then opens
a new session in the app, in the repo, whose first message is `/<skill>` followed by the picked sessions and
stories. The page checks the skill is installed (`~/.claude/skills/<skill>/SKILL.md`) and offers no link while it
is not. Without the key, the page gives you the list to copy into a session of your own. A skill name is letters,
digits, `-`, `_` and `.`.

```json
{ "cleanup": { "skill": "tidy-up" } }
```

## `pipeline`

Where the repo's own checks leave their results, so the Sessions board can move a session past the phases no
session event marks: **PR green** and **Verify**. Each key names a folder, relative to the repo, and a folder left
out is not read. Without the key, no session shows those two phases: Flowwatch does not guess where a repo keeps
its check results.

| Key           | What the folder holds                                                                              | Phase    |
| ------------- | -------------------------------------------------------------------------------------------------- | -------- |
| `passMarkers` | `<commit sha>.json`, written by the pre-merge check when it passes                                 | PR green |
| `goalMarkers` | `<change>/<commit sha>.json`, one subfolder per change, for a check that belongs to one change     | PR green |
| `evidence`    | `.md` or `.json` records of a check run against the real thing, named with `wt-<worktree>` in them | Verify   |

A marker names its session with `session_id`, or its checkout with `worktree` (the session last seen there). One
that names neither, or a checkout no session has used, is skipped: a check nobody's session ran never puts a lane
on the board. The folders are read every 15 seconds.

```json
{ "pipeline": { "passMarkers": ".ci/passed", "evidence": "docs/verification" } }
```

## A complete example

```json
{
  "value": { "command": ["node", "scripts/flowwatch/value.js"] },
  "stages": { "file": "docs/flowwatch/stages.json" },
  "ideas": { "file": "docs/flowwatch/ideas.json" },
  "gates": false,
  "openspec": { "specs": "openspec/specs", "changes": "openspec/changes" },
  "collector": { "port": 4479, "dataDir": ".flowwatch-data" },
  "sessions": {
    "categorize": "scripts/categorize.js",
    "appRecords": "~/Library/Application Support/Claude/claude-code-sessions"
  },
  "cleanup": { "skill": "tidy-up" },
  "pipeline": { "passMarkers": ".ci/passed", "evidence": "docs/verification" }
}
```
