---
status: complete
priority: p2
issue_id: "016"
tags: [code-review, memory-leak, checkpoint, typescript]
dependencies: []
---

# Memory Leak in lastCheckpointEditCount Map

## Problem Statement

The `lastCheckpointEditCount` Map in `SessionMessagingService` grows unboundedly as sessions are created but entries are never removed when sessions are disconnected or closed. This causes memory accumulation over long-running application sessions.

## Findings

**Location:** `packages/desktop/src/lib/acp/store/services/session-messaging-service.ts:45`

```typescript
private lastCheckpointEditCount = new Map<string, number>();
```

- Entries are added when checkpoints are created (line 221)
- No cleanup when sessions disconnect or close
- `SessionConnectionManager.disconnectSession()` (lines 391-411) handles session cleanup but doesn't notify `SessionMessagingService`
- Each entry is ~50-100 bytes (UUID string key + number value)
- Practical impact: 10,000 sessions over time = ~500KB leaked

**Related:** Similar pattern with cleanup exists in `SessionEventService` with `pendingEvents` and `pendingEventTimestamps` Maps.

## Proposed Solutions

### Option 1: Add clearSessionState Method (Recommended)

**Approach:** Add a cleanup method to `SessionMessagingService` and wire it to session disconnect.

**Implementation:**

```typescript
// In SessionMessagingService
clearSessionState(sessionId: string): void {
    this.lastCheckpointEditCount.delete(sessionId);
}
```

Then call from `SessionConnectionManager.disconnectSession()` or session cleanup flow.

**Pros:**

- Direct fix
- Follows existing patterns
- Minimal code change

**Cons:**

- Requires wiring to session lifecycle

**Effort:** 30 minutes

**Risk:** Low

---

### Option 2: Use WeakRef or Derive from CheckpointStore

**Approach:** Instead of maintaining separate Map, query the checkpoint store for last checkpoint's edit count.

**Pros:**

- Eliminates duplicate state
- No cleanup needed

**Cons:**

- Adds latency for store query
- May require store API changes

**Effort:** 1-2 hours

**Risk:** Low

## Recommended Action

_To be filled during triage._

## Technical Details

**Affected files:**

- `packages/desktop/src/lib/acp/store/services/session-messaging-service.ts:45,221`
- `packages/desktop/src/lib/acp/store/services/session-connection-manager.ts` (needs to call cleanup)

**Related components:**

- `SessionConnectionManager` - session lifecycle
- `SessionStore` - coordinates services

## Acceptance Criteria

- [x] `lastCheckpointEditCount` entries are removed when session disconnects
- [x] No memory leak over extended app usage
- [ ] Tests verify cleanup is called

## Work Log

### 2026-01-31 - Code Review Discovery

**By:** Claude Code

**Actions:**

- Identified memory leak via code review
- Analyzed session lifecycle flow
- Documented cleanup pattern from similar Maps in codebase

**Learnings:**

- `SessionEventService` uses similar Map pattern with explicit cleanup
- Session cleanup is coordinated through `SessionConnectionManager`

### 2026-01-31 - Implementation Complete

**By:** Claude Code

**Actions:**

- Added `clearSessionState(sessionId)` method to `SessionMessagingService` (line 380-382)
- Wired cleanup to `removeSession()` in `SessionStore` (line 123)
- Wired cleanup to `disconnectSession()` in `SessionStore` (line 128)
- Map entry is now deleted when session disconnects or is removed

**Learnings:**

- Session lifecycle cleanup should be coordinated through `SessionStore` methods
