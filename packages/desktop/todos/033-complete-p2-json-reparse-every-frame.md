---
status: complete
priority: p2
issue_id: "033"
tags: [code-review, typescript, performance, streaming]
dependencies: []
---

# Full JSON Re-parsing Every Frame

## Problem Statement

Each RAF flush parses ALL accumulated JSON for ALL pending tool calls via `parsePartialJson()`. With 5+ concurrent streaming tools with large JSON, this can consume 10-50ms per frame.

**Why it matters:** JSON parsing is expensive. Re-parsing the same content repeatedly wastes CPU cycles.

## Findings

### Location

`/packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts:871`

### Current Behavior

```typescript
for (const toolCallId of this.pendingStreamingInputParse) {
    const accumulated = this.streamingInputAccumulator.get(toolCallId);
    if (accumulated) {
        const parseResult = parsePartialJson(accumulated);  // Full re-parse every time
```

### Impact

- 5 concurrent tool calls with 50KB each = 250KB parsing per frame
- At 60fps, this is 15MB/second of parse work

## Proposed Solution

Track the last parsed length and only re-parse when new content has been added:

```typescript
// Track last parsed state per tool call
private lastParsedLength = new Map<string, number>();

private flushStreamingInputParse(): void {
    for (const toolCallId of this.pendingStreamingInputParse) {
        const accumulated = this.streamingInputAccumulator.get(toolCallId);
        const lastLength = this.lastParsedLength.get(toolCallId) ?? 0;

        // Only re-parse if content has grown
        if (accumulated && accumulated.length > lastLength) {
            const parseResult = parsePartialJson(accumulated);
            if (parseResult.isOk()) {
                this.streamingInputParsed.set(toolCallId, parseResult.value);
                this.lastParsedLength.set(toolCallId, accumulated.length);
            }
        }
    }
}
```

## Acceptance Criteria

- [ ] Track last parsed length per tool call
- [ ] Skip re-parse if length unchanged
- [ ] Clear tracking state when tool call completes
- [ ] Verify reduced CPU usage during streaming
