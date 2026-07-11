---
module: session-startup
tags: [performance, canonical-data, transcripts, startup]
problem_type: foreground-provider-io
---

# Canonical-first session startup

## Problem

Acepe intentionally delayed restored session work by five seconds, then delayed transcript preload by another thirty seconds. Once work began, session-list reads reopened provider transcript files for usage data, and a cold transcript open rebuilt the full canonical ledger before returning. Existing canonical titles and transcript rows therefore waited behind timers and provider I/O.

## Durable fix

First display now uses separate bounded canonical reads:

- up to 50 persisted projects, with restored project paths first;
- up to 100 session summaries per project and 500 total;
- exact restored session ids in chunks of 32, with the selected session requested independently first;
- a byte-bounded canonical transcript-row-ledger suffix.

Provider discovery and usage parsing run in the Rust indexer. Usage is persisted in a versioned enrichment table and is shown only when its source fingerprint still matches canonical session metadata.

When a transcript ledger is missing or stale, open returns a replayable repair ticket immediately. One Rust coordinator owns selected, visible, and backfill repair with a global concurrency limit, per-session deduplication, priority promotion, and weighted fairness. The frontend awaits the ticket, hydrates the canonical snapshot, and only then reconnects with the open token.

## Rules to preserve

- Never add provider transcript parsing to project/session list commands.
- Never rebuild a missing transcript synchronously inside the foreground open command.
- Never gate visible restored panels behind idle timers or generic backfill.
- Do not clear same-session canonical rows while a fresher snapshot is preparing.
- Reconnect only after canonical hydration so historical replay remains suppressed by the Rust frontier/open-token contract.
- Measure coverage and latency; a SQLite table is not automatically useful or bounded merely because it is canonical.

## Local baseline (2026-07-11)

The development database contained 839 indexed sessions across seven indexed project paths. The largest project had 488 sessions, which proves an unbounded all-session IPC response is not acceptable. Provider distribution was 475 Claude, 172 Cursor, 95 Codex, 90 Copilot, and 7 OpenCode sessions. At the time of measurement, 180 transcript ledgers were current.
