# ADR-0005: Use a durable per-session event sequence authority

## Status

Accepted — 2026-07-16

## Context

Acepe uses `event_seq` as a per-session delivery and claim watermark. A session
open reserves a frontier, historical state is restored through that frontier,
and live delivery continues after it.

The journal previously assigned the next value by reading
`MAX(event_seq) + 1` inside a deferred transaction and then inserting the new
row. Two concurrent appenders could both read the same maximum before either
became SQLite's writer:

```text
Appender A: read 90 -------------------- write 91
Appender B:          read 90 -> write 91
                                      ^ A cannot upgrade its stale read
```

This makes ordinary startup concurrency a correctness failure. Increasing
SQLite's busy timeout does not make the stale read snapshot safe to upgrade.
It also makes retained journal rows an accidental sequence allocator: journal
compaction could appear to move the frontier backwards or allow an old value
to be reused.

Other counters cannot safely fill this role. `graph_revision` tracks changes
to the folded session graph, while `transcript_revision` tracks changes to the
canonical transcript. Either can advance for reasons that do not represent a
delivery event, or remain unchanged for an event that does not affect that
projection.

## Decision

- Each session has one durable SQLite `session_event_sequence` row. That row is
  the sole authority for assigning the session's next `event_seq`.
- Allocation is an atomic, write-first operation. The database increments (or
  creates) the session's counter and returns the assigned value in one SQLite
  statement, rather than reading a maximum before writing.
- When an assigned sequence belongs to a journal event, counter allocation and
  journal insertion commit in the same database transaction. Failure rolls
  back both; no journal row can commit without its authoritative assignment.
- Every `event_seq` producer uses this authority. Journal
  `MAX(event_seq)`, graph revisions, transcript revisions, and synthetic
  in-memory increments are observations or projection state, never allocation
  inputs.
- Journal compaction may remove retained event rows, but it never decreases,
  resets, or reconstructs the durable counter. An assigned sequence is never
  reused.
- `event_seq` remains a per-session delivery/claim watermark. It is distinct
  from `graph_revision` and `transcript_revision`; code must not infer one from
  another.
- Existing sessions receive a one-time backfill that is at least their highest
  already-assigned durable sequence. After that bootstrap, only the
  `session_event_sequence` row advances the value.

## Consequences

**Better**

- Concurrent session startup cannot assign the same sequence through a
  read-then-write race.
- The delivery frontier survives restart and journal compaction independently
  of retained journal contents.
- Allocation and journal persistence have one crash-safe commit boundary.
- Graph and transcript projections can evolve without silently changing
  delivery ordering.

**Costs**

- Every sequence-bearing write must route through the durable allocator.
- The schema needs a counter row per session and a one-time backfill for
  existing sessions.
- Tests must cover concurrent allocation, rollback, restart, and compaction
  without assuming `event_seq == graph_revision == transcript_revision`.

## Alternatives rejected

- **`MAX(event_seq) + 1` in a deferred transaction:** creates the stale-snapshot
  writer-upgrade race and makes compactable rows the allocator.
- **One global auto-increment sequence:** provides uniqueness but changes the
  domain from a per-session watermark to a database-wide counter with unrelated
  gaps between a session's events.
- **An application mutex only:** coordinates one process but is not durable,
  is easy for another connection or future process to bypass, and cannot define
  the restart frontier.
- **Retries or a longer SQLite busy timeout only:** may reduce visible failures
  but retains the read-before-write race and does not establish durable sequence
  ownership.
