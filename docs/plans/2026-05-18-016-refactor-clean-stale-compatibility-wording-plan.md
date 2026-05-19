---
title: "refactor: Clean stale transcript compatibility wording"
type: refactor
status: active
date: 2026-05-18
origin: docs/brainstorms/2026-04-25-final-god-architecture-requirements.md
depends_on:
  - docs/plans/2026-05-18-010-refactor-rename-private-transcript-test-helpers-plan.md
---

# Refactor: Clean Stale Transcript Compatibility Wording

## Overview

Most remaining `compatibility` references in transcript code are historical tests or old planning documents. One production interface comment still says:

```text
Find a tool-call compatibility entry by canonical tool-call id.
```

The method is now a canonical internal lookup used by `TranscriptToolCallBuffer`; keeping the old wording makes guard scans look like a real compatibility writer still exists.

## Scope Boundaries

- Documentation/comment cleanup only.
- No behavior change.
- Do not rename APIs in this slice.

## Implementation Units

- [x] **Unit 1: Update Internal Entry Store Comment**

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/services/interfaces/entry-store-internal.ts`

**Approach:**
- Replace “compatibility entry” with “canonical tool-call transcript row”.

**Execution result:** Updated the internal entry-store interface comment to describe the canonical tool-call transcript row lookup.

## Verification Plan

- Guard before implementation:
  - `rg -n "compatibility entry|compatibility row|compatibility transcript" packages/desktop/src/lib/acp/store packages/desktop/src/lib/acp/logic packages/desktop/src/lib/acp/components/agent-panel -g '*.ts' -g '*.svelte'`
- TypeScript check:
  - not required for comment-only change, but `git diff --check` must pass.
- Guard after implementation:
  - production matches should be gone except test names/comments that explicitly characterize old caches.

## Current Verification

- Guard before implementation found the stale production interface comment.
- Guard after implementation has no production `compatibility entry` match in non-test store/logic/agent-panel code.
- `git diff --check` passed.
