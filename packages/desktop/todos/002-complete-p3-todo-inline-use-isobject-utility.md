---
status: complete
priority: p3
issue_id: "002"
tags: [code-review, consistency, code-quality]
dependencies: []
---

# Use isObject() Utility for Consistency

## Problem Statement

The `todo-inline.svelte` component uses a manual object check instead of the `isObject()` utility function used consistently throughout the codebase. This creates inconsistency and may miss edge cases the utility handles.

## Findings

**Location:** `src/lib/acp/components/tool-calls/todo-inline.svelte` line 33

**Current Code:**

```typescript
if (streamingInput && typeof streamingInput === "object") {
```

**Other Components Use `isObject()`:**

- `search-tool-ui.svelte` (line 32): `if (streamingInput && isObject(streamingInput))`
- `execute-tool-ui.svelte` (line 52): `if (streamingInput && isObject(streamingInput))`
- `edit-tool-ui-state.svelte.ts` (line 47): `if (!streamingInput || !isObject(streamingInput))`

**Note:** The `isObject` utility is imported from `../../utils/partial-json-parser.js`

## Proposed Solutions

### Solution 1: Import and Use isObject (Recommended)

**Pros:**

- Consistent with codebase patterns
- isObject may handle edge cases (e.g., null check built-in)
- Single source of truth for object validation

**Cons:**

- Adds an import

**Effort:** Small (5 min)
**Risk:** Low

```typescript
import { isObject } from "../../utils/partial-json-parser.js";
// ...
if (streamingInput && isObject(streamingInput)) {
```

## Recommended Action

<!-- Filled during triage -->

## Technical Details

**Affected Files:**

- `src/lib/acp/components/tool-calls/todo-inline.svelte`

**Import to Add:**

```typescript
import { isObject } from "../../utils/partial-json-parser.js";
```

## Acceptance Criteria

- [ ] Import `isObject` from partial-json-parser utility
- [ ] Replace `typeof streamingInput === "object"` with `isObject(streamingInput)`
- [ ] Tests still pass
- [ ] TypeScript check passes

## Work Log

| Date       | Action                        | Learnings                                     |
| ---------- | ----------------------------- | --------------------------------------------- |
| 2026-01-31 | Identified during code review | Pattern recognition agent found inconsistency |

## Resources

- Similar usage in: `search-tool-ui.svelte`, `execute-tool-ui.svelte`, `edit-tool-ui-state.svelte.ts`
