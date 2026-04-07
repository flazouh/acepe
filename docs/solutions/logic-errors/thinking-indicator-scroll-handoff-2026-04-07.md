---
title: Keep send-time auto-scroll aligned with the trailing thinking indicator
date: 2026-04-07
category: logic-errors
module: agent panel thread-follow auto-scroll
problem_type: logic_error
component: assistant
symptoms:
  - Sending a message scrolled only to the bottom of the new user bubble, leaving the trailing "Planning next moves" block out of view.
  - The virtualized thread treated the synthetic thinking row as visible content but not as the latest reveal target.
  - An initial force-based fix could leave the thread feeling pinned because a later thinking-row mount still had a forced reveal waiting to fire.
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - tooling
  - testing_framework
tags:
  - auto-scroll
  - thinking-indicator
  - thread-follow
  - agent-panel
  - virtua
  - svelte
---

# Keep send-time auto-scroll aligned with the trailing thinking indicator

## Problem
The agent panel has a synthetic trailing row that shows **"Planning next moves"** while the assistant is thinking. After a user sent a message, the thread was supposed to keep the newest visible activity in view, but the follow logic stopped at the user message instead of the trailing thinking row.

The first repair attempt fixed the visible target in one path, but it used an overly broad forced reveal in the follow controller. That produced a second bug: if the user tried to detach and scroll manually after the user reveal had already fired, a later thinking-row registration could still snap the thread back down.

## Symptoms
- After sending a message, the viewport landed on the bottom edge of the user bubble instead of the trailing thinking block.
- The thread could feel hard to scroll because a later thinking-row mount still had a forced reveal queued from the earlier send action.
- `VirtualizedEntryList` rendered the thinking row as the last display entry, but `getLatestRevealTargetKey(...)` skipped it and pointed follow behavior at the previous entry.
- The resize-observer path and the reveal-target path were coupled even though they needed different answers.

## What Didn't Work
- Treating the newest **non-thinking** entry as the reveal target. That preserved the old behavior because the controller kept revealing the user message instead of the row the user actually needed to see.
- Forcing `prepareForNextUserReveal()` to arm both the next user target and the next latest target. That made the same-render handoff work, but it was too sticky and could fire after the initial user reveal had already settled.
- Reusing one "latest target" concept for both scroll reveal and resize-follow behavior. The thinking indicator should be revealable, but it should not replace the last real streaming/tool entry as the resize-observed node.

## Solution
Split the behavior into two separate decisions:

1. **Reveal target**: use the actual last display entry, including the synthetic thinking row.
2. **Resize-follow target**: keep observing the latest non-thinking entry, because that is the node that grows during streaming/tool execution.

In `packages/desktop/src/lib/acp/components/agent-panel/logic/virtualized-entry-display.ts`, make the reveal target include the last entry and keep a separate helper for resize observation:

```ts
export function getLatestRevealTargetKey(
	displayEntries: readonly VirtualizedDisplayEntry[]
): string | null {
	const lastEntry = displayEntries.at(-1);
	if (!lastEntry) {
		return null;
	}

	return getVirtualizedDisplayEntryKey(lastEntry);
}

function getLatestStreamingResizeTargetKey(
	displayEntries: readonly VirtualizedDisplayEntry[]
): string | null {
	for (let i = displayEntries.length - 1; i >= 0; i -= 1) {
		const entry = displayEntries[i];
		if (!entry || entry.type === "thinking") {
			continue;
		}
		return getVirtualizedDisplayEntryKey(entry);
	}

	return null;
}
```

In `packages/desktop/src/lib/acp/components/agent-panel/logic/thread-follow-controller.svelte.ts`, keep `prepareForNextUserReveal()` narrowly scoped to the next user target. Let a later latest-target registration in the **same frame** replace the pending user target naturally, instead of pre-arming a second forced latest reveal that can survive too long:

```ts
prepareForNextUserReveal(options?: { force?: boolean }): void {
	this.pendingNextUserForce = this.pendingNextUserForce || (options?.force ?? false);
}

private scheduleReveal(
	targetKey: string | null,
	force: boolean,
	options?: { requireLatest?: boolean }
): void {
	const requireLatest = options?.requireLatest ?? true;

	this.pendingTargetKey = targetKey;
	this.pendingForce = this.pendingForce || force;
	this.pendingRequireLatest = requireLatest;
	this.revealFramesRemaining = REVEAL_SETTLE_FRAME_BUDGET;
	if (this.revealRafId !== null) return;
	this.requestRevealFrame();
}
```

That combination preserves the important handoff:

- **Same render**: user message registers first, then trailing thinking row registers later in the same frame and takes over the pending reveal target.
- **Later render**: once the forced user reveal has already flushed, a future thinking-row registration is no longer force-armed, so manual detach/scroll is respected.

Targeted regression coverage added with this fix:

- `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/virtualized-entry-display.test.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/thread-follow-controller.test.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/virtualized-entry-list.svelte.vitest.ts`

## Why This Works
The bug was really two different state machines pretending to be one:

1. **Visibility targeting** asked, "what should the user see right now?"
2. **Growth tracking** asked, "which mounted node is expected to resize while work continues?"

The trailing thinking indicator is the right answer to the first question but not the second. Once those roles are separated, the thread can scroll to the planning block without accidentally moving resize-follow ownership away from the last real content node.

The regression came from making the controller too eager. A send-time forced user reveal is correct, but carrying a second forced latest-target reveal forward into later registrations is not. By removing that extra force and relying on same-frame replacement of the pending target, the controller still lands on the planning row when it is part of the immediate send update, while later manual scroll input is no longer overridden.

## Prevention
- Keep **reveal targeting** and **resize-follow targeting** as separate concepts whenever the list contains synthetic rows like thinking indicators, loaders, or sentinels.
- When a controller uses queued reveals, test both:
  - **same-frame replacement** of a pending target, and
  - **post-flush behavior** after the user has already detached.
- Add regression coverage at both seams:
  - pure logic for target selection,
  - pure controller behavior for pending reveal replacement,
  - component-level virtualized list behavior for the actual scroll index.
- Avoid broad "force the next latest thing too" fixes in scroll controllers. They often work for the happy path but break manual detachment because the force leaks past the frame where it was needed.

## Related Issues
- No related solution docs in `docs/solutions/` matched `auto-scroll`, `thinking`, or `thread-follow` when this was documented.
- `gh issue list --search "auto scroll thinking indicator planning next moves" --state all --limit 5` returned no matching GitHub issues at the time of documentation.
