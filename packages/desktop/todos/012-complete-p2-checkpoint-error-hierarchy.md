---
status: complete
priority: p2
issue_id: "012"
tags: [code-review, architecture, checkpoint]
dependencies: []
---

# CheckpointError Should Extend AcpError

## Problem Statement

`CheckpointError` extends `Error` directly instead of `AcpError` like other error classes. This breaks the error class hierarchy and means code catching `AcpError` will not catch `CheckpointError`.

## Findings

**Location:** `/packages/desktop/src/lib/acp/errors/checkpoint-error.ts` (line 22)

```typescript
export class CheckpointError extends Error {  // Should extend AcpError
```

**Compare with SessionError:** `/packages/desktop/src/lib/acp/errors/session-error.ts` (line 14)

```typescript
export class SessionError extends AcpError {  // Correct pattern
```

**Impact:** Error handling that catches `AcpError` will not catch `CheckpointError`, potentially causing unhandled errors or inconsistent error handling.

## Proposed Solutions

### Solution A: Make CheckpointError Extend AcpError (Recommended)

**Effort:** Small (30 min)
**Risk:** Low

```typescript
import { AcpError } from "./acp-error";

export class CheckpointError extends AcpError {
	constructor(message: string, code: CheckpointErrorCode, cause?: unknown) {
		super(message, code, cause);
		this.name = "CheckpointError";
	}
}
```

**Pros:** Consistent error hierarchy, proper catch behavior
**Cons:** May need to update CheckpointErrorCode to extend AcpErrorCode

## Recommended Action

_To be filled during triage_

## Technical Details

**Affected Files:**

- `packages/desktop/src/lib/acp/errors/checkpoint-error.ts`

**Database Changes:** None

## Acceptance Criteria

- [x] CheckpointError extends AcpError
- [x] Error codes are compatible with AcpErrorCode
- [x] Existing error handling works correctly

## Work Log

| Date       | Action                   | Learnings                                                                                          |
| ---------- | ------------------------ | -------------------------------------------------------------------------------------------------- |
| 2026-01-31 | Created from code review | Pattern-recognition-specialist identified hierarchy break                                          |
| 2026-01-31 | **FIXED**                | Changed CheckpointError to extend AcpError instead of Error, removed redundant errorCause property |

## Resources

- Architecture and pattern review findings
