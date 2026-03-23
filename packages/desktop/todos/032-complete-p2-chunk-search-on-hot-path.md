---
status: complete
priority: p2
issue_id: "032"
tags: [code-review, typescript, performance, streaming]
dependencies: []
---

# O(n) Chunk Search in Hot Path

## Problem Statement

Every streaming chunk update performs a linear `findIndex()` search through all existing chunks to find a matching `partId`. For messages with 500+ chunks, this causes frame drops during streaming.

**Why it matters:** Long streaming responses accumulate many chunks. Each new chunk triggers O(n) search, creating O(n²) total complexity for streaming.

## Findings

### Location

`/packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts:1096`

### Current Behavior

```typescript
const existingChunkIndex = message.chunks.findIndex((chunk) => chunk.partId === input.partId);
```

### Impact

- 50 chunks: 50 comparisons per delta (acceptable)
- 500 chunks: 500 comparisons per delta (problematic)
- 1000 chunks: 1000 comparisons per delta (frame drops)

## Proposed Solution

Add a `partIdIndex` Map similar to the existing `messageIdIndex` pattern:

```typescript
// Map: sessionId -> Map<partId, chunkIndex>
private partIdIndex = new Map<string, Map<string, number>>();
```

Then use O(1) lookup instead of O(n) search.

## Acceptance Criteria

- [ ] Add `partIdIndex` Map for O(1) chunk lookup
- [ ] Update `mergeChunkIntoEntry` to use index instead of findIndex
- [ ] Update index when chunks are added/replaced
- [ ] Clear index when session is cleared
- [ ] Performance test with 500+ chunks shows no frame drops
