# Changelog

## 1.0.5 — 2026-09-24

The early phases stop reading "0m" for work nobody did there.

A phase a session passed without ever being in it — most sessions go from Goal straight to their first commit or
test run — is now shown as skipped: a dashed outline on the board, "skipped" in the session's table. It used to be
painted like a cleared phase with 0 minutes, as if the work there had taken no time.

A turn is split at every moment its phase moved. An agent's long autonomous turn used to credit all its minutes to
the phase it ended in, so every phase it passed through read 0m; now each phase gets the minutes spent in it, and the
tokens spent in that stretch.

A markdown file written in a plans/ folder (where the superpowers writing-plans skill puts a plan) is now the Plan
phase, reported by the live hooks and read from transcripts; before, only a file named tasks.md was. Walking the
transcripts again adds those plan writes to past sessions, including ones that reported live, and nothing twice: an
event id no longer shifts when the reader learns to see a new kind of event.

Stored figures are redone once at the collector's first start, and a database from before gains the column that
records which phases a session was in.

## 1.0.4 — 2026-09-24

1.0.3's corrected per-phase figures now reach sessions that have already finished. Each session's figures are
stored and were redone only when the session got a new event, so on an upgraded board every finished session kept
the old rule's numbers. The collector now redoes all stored figures once, at its first start under a changed rule.

The time a session spent waiting on you is no longer shown: not as a per-phase column, not in a session's total, and
not as the work/wait split among the headline figures. It is still recorded, and still half of what picks the
rollup's ★ target.

## 1.0.3 — 2026-09-24

Two fixes to the per-phase numbers, both found by reading a real board.

A turn's tokens now land on the same phase as its minutes. Work is credited when a turn ends, to the phase reached
by then; spend was credited as it arrived, so a turn that crossed a phase boundary was split across two rows —
"0m work, 96k tokens" beside "14m work, 15k tokens", and neither row true.

Walking the transcript of a session that also reported live now takes only its token figures. The hooks already
recorded that session's prompts and turns; filing the transcript's copy of them beside the hooks' own counted every
prompt twice and cut a turn's minutes at a prompt that never happened. A session the hooks never saw is still
backfilled whole.

## 1.0.2 — 2026-09-24

The per-phase table drops its compute-intensity column: it read n/a for every session, because nothing a session
reports carries the figure it needed.

## 1.0.1 — 2026-09-24

Walking the transcripts again (how a finished session's token figures arrive) no longer marks a session that also
reported live as partial: only a session whose every event came from a transcript is flagged.

## 1.0.0 — 2026-09-22

The first public release. Since 0.9.0: a repo that runs the emitter through a script of its own keeps it —
`install-hooks` sees the working hooks and changes nothing, where it used to add a second set beside them and count
every event twice (SETUP.md step 5 says how to name such a script). The patched qs, body-parser and js-yaml.

## 0.9.0 — 2026-09-22

The first release. A local dashboard, `npx flowwatch start`, for a repo worked on by a fleet of Claude Code agent
sessions: the repo's mission and milestones from its own `MISSION.md`, every open session on one board with the ones
waiting on you first, each session's progress through a 12-phase development pipeline, and optional panels the repo
feeds itself (value figures, stages, ideas, gates). `npx flowwatch check` tells an agent what is left to set up,
`npx flowwatch install-hooks` adds the session-tracking hooks, and `npx flowwatch demo` serves a signed snapshot of
the dashboards.
