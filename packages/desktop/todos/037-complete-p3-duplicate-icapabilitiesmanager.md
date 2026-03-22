---
status: complete
priority: p3
issue_id: "037"
tags: [code-review, typescript, duplication]
dependencies: []
---

# Duplicate ICapabilitiesManager Interface

## Problem Statement

`ICapabilitiesManager` interface was defined in two places:

1. `/packages/desktop/src/lib/acp/store/services/interfaces/capabilities-manager.ts` (with JSDoc)
2. `/packages/desktop/src/lib/acp/store/session-capabilities-store.svelte.ts` (without JSDoc)

## Findings

### Evidence

- Both interfaces had identical signatures
- The one in interfaces/ had proper JSDoc documentation
- The one in the store was a duplicate without documentation

## Solution

- Removed duplicate interface from session-capabilities-store.svelte.ts
- Added import from services/interfaces/capabilities-manager.ts
- Added re-export for backwards compatibility

## Acceptance Criteria

- [x] Duplicate interface removed
- [x] Import added from canonical location
- [x] Re-export added for backwards compatibility
- [x] TypeScript check passes

## Work Log

| Date       | Action                | Notes                            |
| ---------- | --------------------- | -------------------------------- |
| 2026-02-01 | Created and completed | Consolidated duplicate interface |
