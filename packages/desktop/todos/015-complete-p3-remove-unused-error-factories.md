---
status: complete
priority: p3
issue_id: "015"
tags: [code-review, simplicity, checkpoint, cleanup]
dependencies: []
---

# Remove Unused Error Factory Methods

## Problem Statement

`CheckpointError` has 5 static factory methods that are never called. All error creation happens with `new CheckpointError()` directly.

## Findings

**Location:** `/packages/desktop/src/lib/acp/errors/checkpoint-error.ts` (lines 36-72)

**Unused factories:**

- `checkpointNotFound()` (line 36)
- `fileNotFound()` (line 43)
- `revertFailed()` (line 50)
- `createFailed()` (line 57)
- `storageError()` (line 64)

**Verification:** Grep search found no usage of these static methods.

## Proposed Solutions

### Solution A: Remove Unused Factories (Recommended)

**Effort:** Small (15 min)
**Risk:** None

Keep only the constructor:

```typescript
export class CheckpointError extends Error {
	readonly code: CheckpointErrorCode;
	readonly errorCause: Error | undefined;

	constructor(message: string, code: CheckpointErrorCode, cause?: unknown) {
		super(message);
		this.name = "CheckpointError";
		this.code = code;
		this.errorCause = cause instanceof Error ? cause : undefined;
	}
}
```

**Pros:** -36 LOC, simpler class
**Cons:** None

## Recommended Action

_To be filled during triage_

## Technical Details

**Affected Files:**

- `packages/desktop/src/lib/acp/errors/checkpoint-error.ts`

**Database Changes:** None

## Acceptance Criteria

- [x] Unused static methods removed
- [x] Constructor still works
- [x] All existing error creation still compiles

## Work Log

| Date       | Action                   | Learnings                                         |
| ---------- | ------------------------ | ------------------------------------------------- |
| 2026-01-31 | Created from code review | Code-simplicity-reviewer identified unused code   |
| 2026-01-31 | **FIXED**                | Removed 5 unused static factory methods (~40 LOC) |

## Resources

- Simplicity review findings
