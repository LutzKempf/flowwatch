# Setting up Flowwatch in a repo

Flowwatch is a local dashboard for a repo worked on by Claude Code agents. It shows what the repo is trying to
achieve, its milestones and specs, and every open agent session — which ones are waiting on you, and what each
needs — with each session's progress through a 12-phase development pipeline.

This file is written to be followed **top to bottom by an agent**, and read by a person. Every step ends with a way
to tell that it worked. The dashboard's setup banner and `npx flowwatch check` name these steps by number
("step 3 Write the mission") whenever something is missing.

Everything repo-specific comes from files in the repo, never from Flowwatch's own code:

| File                                     | What it holds                                                             | Needed? |
| ---------------------------------------- | ------------------------------------------------------------------------- | ------- |
| `MISSION.md` (repo root, or `docs/`)     | the mission, the current focus, milestones, session categories            | yes     |
| `.claude/settings.json`                  | the session hooks that report each session's progress                     | yes     |
| `flowwatch.json` (repo root, or `docs/`) | where the optional panels read from; the collector's port and data folder | no      |

## 1. Install

Flowwatch installs as a development dependency of the repo, straight from GitHub. It needs **Node 22 or newer**
(`node --version`). Pick a release tag (for example `v1.0.0`) and, from the repo root:

```bash
npm install --save-dev github:LutzKempf/flowwatch#<tag>
```

Its one native dependency, `better-sqlite3`, installs from a prebuilt binary. If your npm is set to block install
scripts, allow them for `better-sqlite3`, or its binary is never fetched.

**It worked when** `npx flowwatch --version` prints the version, and `node -e "require('better-sqlite3')"` prints
nothing. Commit `package.json` and `package-lock.json`, so every clone and worktree gets the same version with its
own `npm install`.

## 2. Start the collector

The collector is the dashboard's server. It listens on `127.0.0.1` only, and serves the repo it is started in (the
top of the git repository, or the folder given with `--repo`).

**First check whether this machine already runs Flowwatch for another repo:**

```bash
npx flowwatch check
```

Read its `Collector:` line. `not reachable on :4477` means nothing runs there: keep the defaults. If it says
`:4477 is the collector of <another repo>`, or `something on :4477 answers, but not as this repo's Flowwatch` (an
older version, or another program), give this repo its own port and data folder, so its sessions never land on
another repo's board. Pick a port nothing answers on, and create or edit `flowwatch.json` at the repo root:

```json
{ "collector": { "port": 4479, "dataDir": ".flowwatch-data" } }
```

and add `.flowwatch-data/` to the repo's `.gitignore`. Without a `collector` entry the defaults are port 4477 and
`~/.flowwatch/` for the database and the session logs — fine for the only repo on a machine. Commit
`flowwatch.json`: the session hooks of every clone read the port from it.

Start it:

```bash
npx flowwatch start
```

It prints the address to open, and runs in the foreground: keep it running the way you keep any local service
running (a scheduled task on Windows, a launchd or systemd user service elsewhere). On its first start it reads the
repo's past Claude Code transcripts once, so the board does not start empty.

**It worked when** the address it printed opens the Sessions panel. Until the next steps are done, a banner at the
top lists what is still missing — that is expected.

## 3. Write the mission

Create `MISSION.md` at the repo root (or in `docs/` if the repo keeps its root clean) from the template:

```bash
cp node_modules/flowwatch/templates/MISSION.md MISSION.md
```

and fill in every `<…>` part:

- **The `#` title** — what the repo is trying to achieve, in a few words. It is the page's headline.
- **The first paragraph under it** — the outcome that matters, and how you will know you are getting closer. The
  page shows it under the headline on every visit.
- **`## Focus`** (optional) — the one thing being pushed right now.
- **`## Milestones`** (optional) — one line each:
  ``- `id` What done looks like — specs: capability-a, capability-b; workstreams: stages-row-id``. The id in
  backticks is what sessions are tagged with: pick it once and never rename it. `specs:` names openspec
  capabilities (their scenario counts become the milestone's status); `workstreams:` names rows of the stages feed
  (step 4). Both are optional.
- **`## Categories`** (optional) — the lanes the repo's work falls into, comma-separated (`Billing, Search, Infra`).
  A session titled `Billing: fix the invoice total` is filed under Billing, and the Sessions panel's filters and
  Cleanup use the list. A line ending in "." or ":" is a note, not a category. A category may own openspec specs,
  one per line: `- Billing — specs: invoices, billing-*` (`name-*` owns every spec starting `name-`). Its lane card
  then shows those specs and the changes that edit them.

**Do not invent the mission.** Take it from the repo's README or its existing docs; if they do not say what the repo
is trying to achieve, ask the person you are working for. A mission an agent made up is worse than the "No mission
yet" card, which at least says it is missing.

**It worked when** `npx flowwatch check` shows `✓ The mission (MISSION.md)` and `✓ MISSION.md reads completely`. A
line the reader could not use is named there, on the page's headline and on the Milestones panel — fix that line;
nothing is guessed or dropped silently. Commit `MISSION.md`.

## 4. Optional panels

Four panels are fed by the repo itself: **Value figures**, **Stages**, **Ideas** and **Gates**. Each one is either
**pointed at its source** — a command Flowwatch runs, or a file it reads — or **turned off**, in `flowwatch.json`.
Left out, a panel shows "not set up" with this step. The feed formats are in [docs/formats.md](docs/formats.md);
every key of the file is in [docs/settings.md](docs/settings.md).

For a repo that has none of these yet:

```json
{ "value": false, "stages": false, "ideas": false, "gates": false }
```

merged with any `collector` entry from step 2. A feed that exists is pointed at instead:
`"stages": { "file": "docs/flowwatch/stages.json" }`, or `"value": { "command": ["node", "scripts/value.js"] }` — a
command is an argument list run without a shell, from the repo root; `"node"` means the Node that runs Flowwatch.

Specs are optional too: the Specs panel and the spec counts read `openspec/specs` and `openspec/changes`. A repo that
keeps them elsewhere says so: `"openspec": { "specs": "spec/features", "changes": "spec/changes" }`. A repo that
does not use openspec turns them off: `"openspec": false`.

Two more settings are optional and read the same way: `sessions.categorize` (a module of the repo's own that files
the sessions whose title names no category) and `cleanup.skill` (the skill that closes what you pick in Cleanup).
See [docs/settings.md](docs/settings.md).

**It worked when** every optional line in `npx flowwatch check` shows `✓` (pointed at its source) or `–` (turned
off). A turned-off panel leaves the sidebar. Commit `flowwatch.json`.

## 5. Session tracking

Claude Code hooks report each session's progress to the collector. Install them into the repo's **tracked**
settings, so every clone and worktree has them:

```bash
npx flowwatch install-hooks
```

It merges into `.claude/settings.json` without replacing anything, and refuses to touch a file that is not valid
JSON. The hooks run `node_modules/flowwatch/hooks/emit.js`, never break a session (`|| true`), and send to the
collector named in step 2. A status line that reports each session's cost is added too, unless the repo already has
one of its own: that one is kept, and the command says the cost figures are not wired.

A repo may run the emitter through a script of its own instead, for example one that finds the package in the
main checkout when a fresh worktree has not installed it yet. Name that script `…/hooks/emit.js` (the check
recognises the hooks by that ending) and have it load `flowwatch/hooks/emit.js`. `install-hooks` then sees the hooks
are already there and changes nothing, since a second set would count every event twice.

Claude Code reads hooks when a session starts: **start a new session in the repo** after installing them.

**It worked when** `npx flowwatch check` shows `✓ Session tracking hooks`, and — once a session has run a command —
its collector line says `last session event <time>`, and the session appears on the Sessions panel. Commit
`.claude/settings.json`, so every clone and worktree reports too.

## 6. Check the setup

```bash
npx flowwatch check
```

It prints the same list as the dashboard's banner, and exits **0** once every required item is done (the mission,
the hooks, a valid `flowwatch.json` when there is one); until then it exits 1. Open the dashboard: the banner is
gone. Make sure what the steps created is committed: `package.json`, `package-lock.json`, `.gitignore`,
`MISSION.md`, `flowwatch.json` and `.claude/settings.json`.
