# Feed formats

Four of Flowwatch's panels show things only the repo knows: the **value** figures on the Mission page's
headline, the **stages** grid, the **ideas** list and the **gates** queue. The repo supplies each one as a
_feed_: a small JSON document that a command prints or a file holds. Flowwatch checks it against the format
below and never guesses what a missing field means.

## Wiring a feed

Each feed has an entry in the repo's `flowwatch.json` (at the repo root, or in `docs/`), under the panel's key:

```json
{
  "value": { "command": ["node", "scripts/flowwatch/value.js"] },
  "stages": { "file": "docs/flowwatch/stages.json" },
  "ideas": false
}
```

- `{ "command": [ ... ] }` runs that program with those arguments, from the repo root, **without a shell**
  (nothing in the list is expanded or split). `"node"` means the Node that runs Flowwatch. It must print the
  feed on standard output within 10 seconds and exit 0.
- `{ "file": "path" }` reads that file, relative to the repo root.
- `false` turns the panel off: the repo does not use it, and it leaves the sidebar.
- No entry: the panel is not set up yet.

Every feed is one JSON object with `"format": 1`. A feed with no `format`, or another number, is refused with
that reason; a later Flowwatch that reads a new format will say so the same way.

## The states a panel can be in

Every one of the four panels is in exactly one of these, and the page says which. An empty panel only ever
means the feed was read and had nothing in it.

| State        | When                                                                         | What the page shows                                                                                 |
| ------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `data`       | the feed was read and matches its format                                     | the panel                                                                                           |
| `not-set-up` | `flowwatch.json` has no entry for the panel, or there is no `flowwatch.json` | that it is not set up in this repo, and how to set it up                                            |
| `off`        | the entry is `false`                                                         | that this repo does not use the panel (the value figures show nothing); its sidebar entry is hidden |
| `error`      | anything else, with its reason                                               | "Could not be read:" and the reason                                                                 |

An error's reason names what went wrong: `flowwatch.json` is not valid JSON or cannot be read; the entry has
neither or both of `command` and `file`; the file is not there; the command could not start, exited with a
code (its first error line is quoted), or ran past 10 seconds; the output is not JSON; the format number is
missing or wrong; or the feed does not match its format (the first three problems are named, and how many
more there are).

The Mission page's payload (`GET /api/mission`) carries each panel's state under `panels` (for example
`"panels": { "stages": { "state": "error", "reason": "…" } }`) and its data under the panel's own key, `null`
unless the state is `data`. `GET /api/gates` answers with the gates feed itself plus `"state": "data"`, or with
only `state` and, for an error, `reason`.

## value

The figures on the Mission page's headline, measured in outcomes the repo chooses. Each figure is a sentence
the repo words itself, because only it knows whether a missing number means "none yet" or "not recorded".

| Field            | Required | What it is                                                               |
| ---------------- | -------- | ------------------------------------------------------------------------ |
| `figures`        | yes      | 1 to 8 figures, shown in this order                                      |
| `figures[].text` | yes      | the sentence, at most 200 characters; `**…**` marks the parts shown bold |
| `figures[].tone` | no       | `good`, `bad`, `warn` or `neutral` (the default): the figure's colour    |

Everything else in the text is shown as text: no markup a feed writes is ever read as HTML.

```json
{
  "format": 1,
  "figures": [
    { "text": "**2 of 3** checkout flows take real payments", "tone": "good" },
    { "text": "**4 days** since a customer-visible release", "tone": "warn" },
    { "text": "**31** orders completed without calling support" }
  ]
}
```

## stages

The stages the repo's work moves through, in the repo's own words, and how far each workstream has got. The
grid's header, its legend and the milestone labels all come from here: Flowwatch has no stage names of its own.

| Field                 | Required | What it is                                                                                |
| --------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `stages`              | yes      | 1 to 20 stage names, in order, each used once                                             |
| `milestoneStatus`     | no       | one label per stage: what a milestone at that stage is called (default: the stage's name) |
| `workstreams`         | yes      | the rows; may be empty                                                                    |
| `workstreams[].id`    | yes      | a unique id; a milestone names its workstreams by these                                   |
| `workstreams[].name`  | yes      | the row's title                                                                           |
| `workstreams[].role`  | no       | a short word under the title                                                              |
| `workstreams[].cells` | yes      | exactly one state per stage (below)                                                       |
| `warnings`            | no       | sentences shown under the grid, such as rows the feeder could not read                    |

A cell is one of:

| Cell       | Means                                                  |
| ---------- | ------------------------------------------------------ |
| `passed`   | the stage was passed, with evidence                    |
| `inferred` | assumed passed, with no evidence named                 |
| `frontier` | the furthest stage reached; at most one per workstream |
| `skipped`  | skipped on purpose                                     |
| `failed`   | tried and failed                                       |
| `voided`   | once passed, undone by an earlier failure              |
| `none`     | not reached                                            |

**Milestones follow their workstreams.** A milestone in `MISSION.md` names the rows its status follows:
``- `guest-checkout-live` Guest checkout in production — specs: checkout-flow; workstreams: guest-checkout``.
A workstream has got as far as its `frontier` cell, or, without one, its furthest `passed` or `inferred`
cell. The milestone takes the furthest of its workstreams, and its status is that stage's `milestoneStatus`
label, or the stage's name. A milestone that names no workstream, or whose workstreams have reached no
stage, takes its status from its specs instead.

```json
{
  "format": 1,
  "stages": ["idea", "design", "build", "trial", "rollout", "live"],
  "milestoneStatus": ["proposed", "designed", "building", "in trial", "rolling out", "live"],
  "workstreams": [
    {
      "id": "guest-checkout",
      "name": "Guest checkout",
      "role": "flow",
      "cells": ["passed", "passed", "inferred", "passed", "frontier", "none"]
    },
    {
      "id": "saved-cards",
      "name": "Saved cards",
      "role": "flow",
      "cells": ["passed", "frontier", "failed", "none", "none", "none"]
    }
  ],
  "warnings": []
}
```

## ideas

Every idea the repo has evaluated, in the repo's own sections, each with its verdict in the repo's words and
the bucket that verdict falls in. Flowwatch counts each section's buckets and finds its latest date itself;
counts a feed writes are ignored.

| Field              | Required | What it is                                                                         |
| ------------------ | -------- | ---------------------------------------------------------------------------------- |
| `source`           | no       | where the ideas are kept, shown under the panel                                    |
| `sections`         | yes      | the groups, in order; may be empty                                                 |
| `sections[].title` | yes      | the group's title                                                                  |
| `sections[].ideas` | yes      | its ideas; may be empty                                                            |
| `ideas[].n`        | no       | the idea's number, a whole number                                                  |
| `ideas[].name`     | yes      | what the idea is                                                                   |
| `ideas[].verdict`  | yes      | the verdict, in the repo's words                                                   |
| `ideas[].bucket`   | yes      | `closed` (ruled out), `inconclusive`, `open` (open or promising) or `unclassified` |
| `ideas[].evidence` | no       | the numbers behind the verdict                                                     |
| `ideas[].date`     | no       | the day of the verdict, `YYYY-MM-DD`                                               |
| `ideas[].docs`     | no       | where the write-up is                                                              |
| `warnings`         | no       | sentences shown under the summary, such as rows the feeder could not read          |

```json
{
  "format": 1,
  "source": "docs/checkout-ideas.md",
  "sections": [
    {
      "title": "Checkout flow",
      "ideas": [
        {
          "n": 1,
          "name": "Guest checkout without an account",
          "verdict": "Promising: completion up 6 points",
          "bucket": "open",
          "evidence": "trial over 1,200 carts",
          "date": "2026-08-20",
          "docs": "docs/guest-checkout-trial.md"
        },
        {
          "n": 2,
          "name": "Address autocomplete",
          "verdict": "Ruled out: no change in completion",
          "bucket": "closed",
          "evidence": "900 carts, +0.3 points",
          "date": "2026-07-30"
        }
      ]
    },
    {
      "title": "Payments",
      "ideas": [{ "name": "Wallet buttons", "verdict": "Not sorted yet", "bucket": "unclassified" }]
    }
  ],
  "warnings": []
}
```

## gates

What the repo's gate runner is running, what waits in the order it will start them, the state of its
scheduler, and how long gates usually take. The panel is read-only: it shows the runner's order and never
changes it. Times are milliseconds since 1970; durations are milliseconds, except `history`'s, which are
whole minutes. `GET /api/gates` reads the feed at most once every 10 seconds, however many pages poll it.

| Field                             | Required | What it is                                                                                                                                                  |
| --------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generated_at`                    | no       | when the feed was made                                                                                                                                      |
| `running`                         | yes      | the gates running now; may be empty                                                                                                                         |
| `running[].worktree`              | yes      | the checkout the gate runs in                                                                                                                               |
| `running[].granted_at`            | yes      | when it started; the page counts on from here                                                                                                               |
| `running[].branch`, `sha`, `mode` | no       | text shown with it                                                                                                                                          |
| `running[].ran_ms`, `cores`       | no       | numbers from 0                                                                                                                                              |
| `waiting`                         | yes      | the gates waiting, in the order the runner will start them; may be empty                                                                                    |
| `waiting[].position`              | yes      | its place in that order, from 1                                                                                                                             |
| `waiting[].worktree`              | yes      | the checkout it waits for                                                                                                                                   |
| `waiting[].branch`, `sha`         | no       | text shown with it                                                                                                                                          |
| `waiting[].queued_since`          | no       | when it joined the queue                                                                                                                                    |
| `waiting[].waited_ms`             | no       | how long it has waited, used when `queued_since` is absent                                                                                                  |
| `scheduler`                       | no       | the scheduler's state; leave it out if the runner has none                                                                                                  |
| `scheduler.tick_age_ms`           | no       | how long ago the scheduler last ran; `null`: it never has                                                                                                   |
| `scheduler.stalled`               | no       | `true` when it has stopped: the page says nothing will start                                                                                                |
| `scheduler.blocked`               | no       | why nothing new starts right now, in the scheduler's words                                                                                                  |
| `scheduler.mode`                  | no       | the scheduler's mode                                                                                                                                        |
| `history`                         | no       | how long passed gates took: `runs`, `p25`, `median`, `p75`, `p90` (whole minutes) and `window_days`, all numbers; `null` when there are too few runs to say |

A gate is shown with the title of a session on the Sessions board that has the same worktree and branch;
otherwise with its branch, then its worktree.

```json
{
  "format": 1,
  "generated_at": 1789999800000,
  "scheduler": {
    "tick_age_ms": 4000,
    "mode": "active",
    "blocked": "concurrency cap reached (1 of 1 in active mode)",
    "stalled": false
  },
  "running": [
    {
      "worktree": "checkout-guest-form",
      "branch": "feat/guest-address-form",
      "sha": "a1b2c3d",
      "granted_at": 1789999080000,
      "ran_ms": 720000,
      "mode": "active",
      "cores": 4
    }
  ],
  "waiting": [
    {
      "position": 1,
      "worktree": "checkout-cart-totals",
      "branch": "fix/cart-totals",
      "sha": "d4e5f6a",
      "queued_since": 1789999500000,
      "waited_ms": 300000
    }
  ],
  "history": { "runs": 24, "p25": 12, "median": 14, "p75": 17, "p90": 21, "window_days": 14 }
}
```
