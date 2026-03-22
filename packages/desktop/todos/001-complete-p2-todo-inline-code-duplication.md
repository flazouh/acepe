---
status: complete
priority: p2
issue_id: "001"
tags: [code-review, code-quality, refactoring]
dependencies: []
---

# Extract Duplicate filter/map Logic in parseRawTodos

## Problem Statement

The `parseRawTodos()` function in `todo-inline.svelte` contains **24 lines of identical code** duplicated between the streaming input path and the fallback path. This violates the DRY (Don't Repeat Yourself) principle and makes maintenance harder.

## Findings

**Location:** `src/lib/acp/components/tool-calls/todo-inline.svelte` lines 36-48 and 61-73

The identical filter/map block appears twice:

```typescript
// Lines 36-48 (streaming input path)
.filter(
    (t): t is { content: string; status: string; activeForm?: string } =>
        typeof t === "object" &&
        t !== null &&
        typeof (t as Record<string, unknown>).content === "string" &&
        typeof (t as Record<string, unknown>).status === "string"
)
.map((t) => ({
    content: t.content,
    status: t.status as TodoItem["status"],
    activeForm: typeof t.activeForm === "string" ? t.activeForm : "",
}));

// Lines 61-73 (fallback path) - IDENTICAL
```

**Impact:**

- Code duplication makes maintenance error-prone
- Bug fixes must be applied in two places
- Increases component complexity

## Proposed Solutions

### Solution 1: Extract Helper Function (Recommended)

**Pros:**

- Reduces code by ~12 lines
- Single source of truth for parsing logic
- Easy to test

**Cons:**

- None significant

**Effort:** Small (15 min)
**Risk:** Low

```typescript
function parseTodosArray(todos: unknown[]): TodoItem[] {
	return todos
		.filter(
			(t): t is { content: string; status: string; activeForm?: string } =>
				typeof t === "object" &&
				t !== null &&
				typeof (t as Record<string, unknown>).content === "string" &&
				typeof (t as Record<string, unknown>).status === "string"
		)
		.map((t) => ({
			content: t.content,
			status: t.status as TodoItem["status"],
			activeForm: typeof t.activeForm === "string" ? t.activeForm : "",
		}));
}

function parseRawTodos(): TodoItem[] {
	// Try streaming input first
	if (streamingInput && typeof streamingInput === "object") {
		const streaming = streamingInput as Record<string, unknown>;
		if (Array.isArray(streaming.todos)) {
			return parseTodosArray(streaming.todos);
		}
	}

	// Fall back to toolCall.arguments.raw
	if (toolCall.arguments.kind !== "think") return [];
	const raw = toolCall.arguments.raw;
	if (!raw || typeof raw !== "object") return [];
	const rawObj = raw as Record<string, unknown>;
	if (!Array.isArray(rawObj.todos)) return [];

	return parseTodosArray(rawObj.todos);
}
```

## Recommended Action

<!-- Filled during triage -->

## Technical Details

**Affected Files:**

- `src/lib/acp/components/tool-calls/todo-inline.svelte`

**Lines Changed:** Remove ~12 duplicate lines, add helper function

## Acceptance Criteria

- [ ] Helper function `parseTodosArray` extracts the filter/map logic
- [ ] `parseRawTodos` calls the helper for both streaming and fallback paths
- [ ] Tests still pass
- [ ] TypeScript check passes

## Work Log

| Date       | Action                        | Learnings                                   |
| ---------- | ----------------------------- | ------------------------------------------- |
| 2026-01-31 | Identified during code review | Pattern recognition agent found duplication |

## Resources

- PR context: Streaming fix for TodoWrite progressive display
- Similar pattern: `search-tool-content.svelte` uses extracted parsing
