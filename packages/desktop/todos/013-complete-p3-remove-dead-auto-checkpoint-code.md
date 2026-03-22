---
status: complete
priority: p3
issue_id: "013"
tags: [code-review, simplicity, checkpoint, cleanup]
dependencies: []
---

# Remove Dead Auto-Checkpoint Code

## Problem Statement

The entire `checkpoint-auto-create.ts` file and its test file are dead code - never imported or used in production. This adds ~350 lines of unused code.

## Findings

**Location:** `/packages/desktop/src/lib/acp/store/checkpoint-auto-create.ts` (entire file)

**Unused functions:**

- `createAutoCheckpointIfNeeded()` (lines 70-122)
- `shouldCreateAutoCheckpoint()` (lines 43-57)
- `extractEditFilePath()` (lines 131-149)

**Verification:** Grep search found no imports of these functions in production code.

**Also unused:**

- `packages/desktop/src/lib/acp/store/__tests__/checkpoint-auto-create.vitest.ts` - tests for unused code

## Proposed Solutions

### Solution A: Delete Unused Files (Recommended)

**Effort:** Small (15 min)
**Risk:** None

Delete:

- `src/lib/acp/store/checkpoint-auto-create.ts`
- `src/lib/acp/store/__tests__/checkpoint-auto-create.vitest.ts`

**Pros:** -350 LOC, simpler codebase
**Cons:** If auto-checkpoint feature is needed later, must reimplement (but YAGNI)

### Solution B: Integrate Auto-Checkpoint Feature

**Effort:** Medium (2-3 hours)
**Risk:** Low

If the feature is wanted, integrate it into the session event handling.

**Pros:** Feature becomes useful
**Cons:** May not be needed, scope creep

## Recommended Action

_To be filled during triage_

## Technical Details

**Affected Files:**

- `packages/desktop/src/lib/acp/store/checkpoint-auto-create.ts` (DELETE)
- `packages/desktop/src/lib/acp/store/__tests__/checkpoint-auto-create.vitest.ts` (DELETE)

**Database Changes:** None

## Acceptance Criteria

- [x] Dead code files removed
- [x] No broken imports
- [x] Tests still pass

## Work Log

| Date       | Action                   | Learnings                                                              |
| ---------- | ------------------------ | ---------------------------------------------------------------------- |
| 2026-01-31 | Created from code review | Code-simplicity-reviewer identified YAGNI violation                    |
| 2026-01-31 | **FIXED**                | Deleted checkpoint-auto-create.ts and its test file (~350 LOC removed) |

## Resources

- Simplicity review findings
