# Changelog

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
