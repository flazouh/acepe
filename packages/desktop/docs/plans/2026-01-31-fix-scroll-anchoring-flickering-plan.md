---
title: Fix Scroll Anchoring Flickering
type: fix
date: 2026-01-31
---

# Fix Scroll Anchoring Flickering

## Overview

The scroll anchoring system in `virtualized-entry-list.svelte` causes severe flickering (100Hz+) when the user attempts to scroll up during AI streaming. The view rapidly oscillates between user's scroll position and auto-scroll position.

## Problem Statement

**Symptoms:**

- User tries to scroll up during streaming
- View flickers rapidly, fighting between user control and auto-scroll
- Cannot break free from the bottom anchor
- Extremely disruptive UX

**Root Cause Analysis:**

The conflict occurs in `handleVListScroll`:

```typescript
function handleVListScroll(): void {
	if (!vlistRef) return;

	// BUG: This fires for BOTH programmatic scrolls AND user scrolls
	if (userWantsControl && isNearBottom()) {
		userWantsControl = false; // Immediately re-engages auto-scroll!
		anchorIndex = null;
	}
}
```

**The Fight Sequence:**

1. User triggers wheel event → `userWantsControl = true`
2. VList's `onscroll` callback fires (for ANY scroll, including programmatic)
3. During streaming, content grows constantly, so `isNearBottom()` often returns `true`
4. `handleVListScroll` immediately sets `userWantsControl = false`
5. Next frame: auto-scroll effect runs → calls `scrollToIndex`
6. This triggers another `onscroll` → cycle repeats at 60fps

**Why `isNearBottom()` lies during streaming:**

- Content height is constantly increasing
- User's scroll up is tiny compared to content growth
- `scrollSize - (offset + viewport) < 100` is often true even when user is actively scrolling up

## Proposed Solution

### Approach: Debounced Re-engagement with Streaming Guard

The re-engage logic should ONLY run when:

1. User has been at bottom for a sustained period (debounce)
2. AND streaming has stopped OR user explicitly scrolled DOWN to bottom

```typescript
// State
let userWantsControl = $state(false);
let reengageTimer: ReturnType<typeof setTimeout> | undefined;

// When user interacts with scroll
function handleUserScrollIntent(): void {
	// Cancel any pending re-engage
	if (reengageTimer) {
		clearTimeout(reengageTimer);
		reengageTimer = undefined;
	}
	userWantsControl = true;
}

// On VList scroll - only consider re-engage when NOT streaming
function handleVListScroll(): void {
	if (!vlistRef) return;

	// Don't re-engage during active streaming - too aggressive
	if (isStreaming) return;

	// Only consider re-engage if user has control and is at bottom
	if (userWantsControl && isNearBottom()) {
		// Debounce: require staying at bottom for 200ms
		if (reengageTimer) clearTimeout(reengageTimer);
		reengageTimer = setTimeout(() => {
			if (isNearBottom()) {
				// Re-check
				userWantsControl = false;
				anchorIndex = null;
			}
		}, 200);
	}
}

// Cleanup
onDestroy(() => {
	if (reengageTimer) clearTimeout(reengageTimer);
});
```

### Key Changes

1. **No re-engage during streaming**: `if (isStreaming) return;` at the start of `handleVListScroll`
2. **Debounced re-engage**: User must be at bottom for 200ms after streaming stops
3. **Clear timer on user input**: Any wheel/touch/key cancels pending re-engage

### Alternative: Track Scroll Direction

Instead of debouncing, detect if user is scrolling UP vs DOWN:

```typescript
let lastScrollOffset = 0;

function handleVListScroll(): void {
	if (!vlistRef) return;

	const currentOffset = vlistRef.getScrollOffset();
	const scrolledUp = currentOffset < lastScrollOffset - 5;
	const scrolledDown = currentOffset > lastScrollOffset + 5;
	lastScrollOffset = currentOffset;

	// If scrolled up, user definitely wants control
	if (scrolledUp && !userWantsControl) {
		userWantsControl = true;
	}

	// Only re-engage on intentional scroll DOWN to bottom (not during streaming)
	if (!isStreaming && scrolledDown && userWantsControl && isNearBottom()) {
		userWantsControl = false;
		anchorIndex = null;
	}
}
```

**Problem:** This reintroduces scroll position tracking, but now it's ONLY in `handleVListScroll`, not in a guard that blocks effects. The key difference: we track direction to detect INTENTIONAL scroll to bottom, not to block auto-scroll.

### Recommended: Hybrid Approach

Combine both strategies:

```typescript
let lastScrollOffset = 0;
let scrollDirection: "up" | "down" | "none" = "none";

function handleVListScroll(): void {
	if (!vlistRef) return;

	const currentOffset = vlistRef.getScrollOffset();
	const delta = currentOffset - lastScrollOffset;

	if (delta < -10) scrollDirection = "up";
	else if (delta > 10) scrollDirection = "down";
	// else: small movement, keep previous direction

	lastScrollOffset = currentOffset;

	// NEVER re-engage while streaming - this is the key fix
	if (isStreaming) return;

	// Re-engage only on intentional downward scroll to bottom
	if (scrollDirection === "down" && userWantsControl && isNearBottom()) {
		userWantsControl = false;
		anchorIndex = null;
	}
}
```

## Acceptance Criteria

- [ ] User can scroll up during streaming without flickering
- [ ] View stays where user scrolled (doesn't snap back)
- [ ] When user scrolls back to bottom after streaming stops, auto-scroll re-engages
- [ ] New user message still anchors properly
- [ ] No regression in normal auto-scroll behavior

## Technical Details

**Affected Files:**

- `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte`

**Key Functions to Modify:**

- `handleVListScroll()` - Add streaming guard and direction tracking
- Add cleanup for any new timers in `onDestroy`

## Implementation Steps

### Phase 1: Fix the Immediate Bug (Critical)

1. Add `if (isStreaming) return;` at start of `handleVListScroll`
2. This alone should stop the flickering

### Phase 2: Improve Re-engage Logic

1. Add scroll direction tracking
2. Only re-engage on intentional downward scroll to bottom
3. Reset `scrollDirection` on user input events

### Phase 3: Test Scenarios

1. Start streaming → try to scroll up → should stay up, no flicker
2. Streaming stops → scroll down to bottom → auto-scroll re-engages
3. Send new message → view anchors to new message
4. Long session with many entries → performance OK

## MVP

### virtualized-entry-list.svelte (handleVListScroll fix)

```typescript
// Add scroll direction tracking
let lastScrollOffset = 0;

function handleVListScroll(): void {
	if (!vlistRef) return;

	const currentOffset = vlistRef.getScrollOffset();
	const scrolledDown = currentOffset > lastScrollOffset + 10;
	lastScrollOffset = currentOffset;

	// CRITICAL: Never re-engage during active streaming
	// This was causing the 100Hz flickering
	if (isAutoScrollActive()) return;

	// Re-engage only on intentional downward scroll to bottom
	if (scrolledDown && userWantsControl && isNearBottom()) {
		userWantsControl = false;
		anchorIndex = null;
	}
}
```

## References

- Original issue: Scroll anchoring doesn't work, causes flickering
- Component: `virtualized-entry-list.svelte`
- Library: `virtua/svelte` VList
