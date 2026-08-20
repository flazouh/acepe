# ADR-0006: Version orchestration events by adding tagged members

## Status

Accepted — 2026-08-20

## Context

Acepe rebuilds on an event-sourced orchestration core. `OrchestrationEvent` is the durable record. Projectors, the event store, and the replay harness decode historical payloads years after they were appended.

A payload change that looks small in source is a break in the log. Adding `updatedAt` to an existing member, renaming a field, or reusing a type tag for a new shape makes old rows undecodable. That failure shows up as a rebuild that cannot catch up, not as a type error at the write site.

Commands can evolve more freely because they are not replayed. Events cannot.

## Decision

- Version events by adding a new tagged member to `OrchestrationEvent`. Never change the fields of an existing payload schema.
- Keep the original `type` tag and payload shape readable for as long as the event store retains those rows.
- Put new facts on a new member (`ProjectMetaUpdatedV2`, or a distinct tag such as `ProjectWorkspaceMoved`). Projectors must handle both the old member and the new one.
- Keep time on the envelope `occurredAt` field. Event payloads are append-only facts and must not carry `updatedAt`-style mutable fields.
- Corrections append a new event. They do not rewrite a stored payload.

## Consequences

**Better**

- The event store stays readable as the product grows.
- Replay and projection rebuild stay deterministic for old sequences.
- The type union makes missing projector cases a compile error when a member is added.

**Costs**

- A field that was modeled too narrowly needs a new member instead of an in-place edit.
- Projectors accumulate handlers for superseded members until a snapshot policy retires them.

## Alternatives rejected

- **Change the payload in place and migrate the table:** hides the break until replay. A migration that rewrites history is not an event log.
- **Put a schema version integer inside each payload:** invites `if (version === 1)` branches and still needs a new shape. A new tagged member is the version.
- **Copy mutable snapshot fields such as `updatedAt` onto payloads:** treats events as rows that change. The envelope already records when the fact occurred.
