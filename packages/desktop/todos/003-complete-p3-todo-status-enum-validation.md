---
status: complete
priority: p3
issue_id: "003"
tags: [code-review, defensive-coding, type-safety]
dependencies: []
---

# Add Enum Validation for Todo Status Field

## Problem Statement

The `status` field from streaming input is cast directly to `TodoItem["status"]` without validating it's a valid enum value. While Svelte's XSS protection prevents security issues, unexpected status values could cause UI inconsistencies.

## Findings

**Location:** `src/lib/acp/components/tool-calls/todo-inline.svelte` line 47

**Current Code:**

```typescript
.map((t) => ({
    content: t.content,
    status: t.status as TodoItem["status"],  // No validation
    activeForm: typeof t.activeForm === "string" ? t.activeForm : "",
}));
```

**Expected Status Values:**

```typescript
type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
```

If a malicious or malformed input sends `status: "invalid"`, it would be passed through and could cause unexpected UI behavior in `TodoStatusBadge`.

## Proposed Solutions

### Solution 1: Add Runtime Enum Validation (Recommended)

**Pros:**

- Defense in depth
- Clear error handling for unexpected values
- Self-documenting code

**Cons:**

- Slightly more code

**Effort:** Small (10 min)
**Risk:** Low

```typescript
const validStatuses = new Set<TodoItem["status"]>(["pending", "in_progress", "completed", "cancelled"]);

function isValidStatus(status: string): status is TodoItem["status"] {
    return validStatuses.has(status as TodoItem["status"]);
}

// In the filter:
.filter(
    (t): t is { content: string; status: TodoItem["status"]; activeForm?: string } =>
        typeof t === "object" &&
        t !== null &&
        typeof (t as Record<string, unknown>).content === "string" &&
        typeof (t as Record<string, unknown>).status === "string" &&
        isValidStatus((t as Record<string, unknown>).status as string)
)
```

### Solution 2: Default Invalid Status to "pending"

**Pros:**

- Graceful degradation
- No items lost due to bad status

**Cons:**

- Silently hides data issues

**Effort:** Small (5 min)
**Risk:** Low

```typescript
.map((t) => ({
    content: t.content,
    status: validStatuses.has(t.status) ? t.status : "pending",
    activeForm: typeof t.activeForm === "string" ? t.activeForm : "",
}));
```

## Recommended Action

<!-- Filled during triage -->

## Technical Details

**Affected Files:**

- `src/lib/acp/components/tool-calls/todo-inline.svelte`

**TodoItem Status Type (from converted-session-types.ts):**

```typescript
status: "pending" | "in_progress" | "completed" | "cancelled";
```

## Acceptance Criteria

- [ ] Invalid status values are either filtered out or defaulted
- [ ] Valid status values pass through unchanged
- [ ] Tests still pass
- [ ] TypeScript check passes

## Work Log

| Date       | Action                        | Learnings                                 |
| ---------- | ----------------------------- | ----------------------------------------- |
| 2026-01-31 | Identified during code review | Security agent flagged loose type casting |

## Resources

- Security analysis: "Loose Status Validation (Low Risk)"
