---
status: complete
priority: p3
issue_id: "020"
tags: [code-review, lint, checkpoint, typescript]
dependencies: []
---

# Add ESLint Disable Comment for Checkpoint Map

## Problem Statement

The `lastCheckpointEditCount` Map in `SessionMessagingService` is missing the ESLint disable comment that other similar Maps in the codebase have. This creates inconsistency and may trigger linting warnings.

## Findings

**Location:** `packages/desktop/src/lib/acp/store/services/session-messaging-service.ts:45`

**Current:**

```typescript
private lastCheckpointEditCount = new Map<string, number>();
```

**Codebase pattern (from `session-event-service.svelte.ts`):**

```typescript
// eslint-disable-next-line svelte/prefer-svelte-reactivity
private pendingEvents = new Map<string, SessionUpdate[]>();
// eslint-disable-next-line svelte/prefer-svelte-reactivity
private pendingEventTimestamps = new Map<string, number>();
```

The Map is purely internal tracking (not exposed to UI), so using plain `Map` is correct. However, the ESLint disable comment is needed for consistency.

## Proposed Solutions

### Option 1: Add ESLint Comment (Recommended)

**Approach:** Add the disable comment above the Map declaration.

```typescript
// eslint-disable-next-line svelte/prefer-svelte-reactivity
private lastCheckpointEditCount = new Map<string, number>();
```

**Pros:**

- Consistent with codebase
- Documents intentional choice
- Prevents lint warnings

**Cons:**

- None

**Effort:** 1 minute

**Risk:** None

## Recommended Action

Add the ESLint disable comment. Trivial fix.

## Technical Details

**Affected files:**

- `packages/desktop/src/lib/acp/store/services/session-messaging-service.ts:45`

## Acceptance Criteria

- [x] ESLint disable comment added
- [x] No lint warnings for this line

## Work Log

### 2026-01-31 - Pattern Recognition Review

**By:** Claude Code

**Actions:**

- Identified missing ESLint comment via pattern analysis
- Verified codebase convention

**Learnings:**

- Non-reactive Maps in services should have ESLint disable comment

### 2026-01-31 - Already Implemented

**By:** Claude Code

**Actions:**

- Verified ESLint comment was already present at line 45
- Comment was added during the initial implementation of `lastCheckpointEditCount` Map

**Learnings:**

- The comment was already in place from the original implementation
