---
title: Enforce TDD red-first for bugs, behavior changes, and non-trivial refactors
date: 2026-06-14
last_updated: 2026-06-14
category: docs/solutions/best-practices
module: engineering workflow
problem_type: workflow_issue
component: ce_workflow
severity: high
applies_when:
  - Fixing a bug or changing observable behavior
  - Doing a non-trivial refactor (extracting a controller, moving a state machine, deleting mirror state)
  - Writing or reviewing a plan whose units claim "TDD" or "characterization"
  - Adding tests around a stateful spine (Svelte `$effect`, mirror `let` flags, async listener lifecycles)
root_cause: implementation_before_proof
resolution_type: workflow_improvement
tags: [tdd, red-first, characterization, refactor, testing, ce-workflow, svelte]
---

# Enforce TDD red-first for bugs, behavior changes, and non-trivial refactors

## Rule

For any bug fix, behavior change, or non-trivial refactor: **write the failing (red) test first, watch it fail, then write the smallest change that turns it green.** Implementation before a failing test is not allowed in this workflow (CLAUDE.md CE Workflow, Hard Rule 4). Refactors are **not** exempt — extracting a controller or deleting mirror state is exactly where untested spines hide bugs.

This is a process rule, not a suggestion. A plan unit that lists implementation before its red test, or that has no red test at all for feature-bearing work, is incomplete.

## Why

The deepening work in this codebase repeatedly shows the same shape: pure predicate functions are well-tested, but the **stateful spine that calls them** — `$effect` blocks, non-reactive mirror `let` flags, async listener init/dispose — holds the real bugs and has no test surface. Red-first forces a test at the calling-context seam *before* you touch it, which:

1. Proves the bug exists (you have a reproduction, not a hypothesis).
2. Proves your change is the cause of green (no "fixed it by accident / fixed something else").
3. Bounds the change — green is the stopping condition.

## Guardrails (the non-obvious failure modes)

These are the traps that make "we did TDD" untrue in practice:

- **Characterization must capture *preserved* behavior, never the bug.** When you write a characterization test to "capture current behavior before changing it," you must exclude the behavior you are about to delete. If the current behavior *is* the bug (e.g. a scroll teleport, a stale pin), a characterization test that pins all current outputs will **lock in the bug** — the implementer then has to preserve the teleport to keep the test green, directly contradicting the fix. Split it: one **prescriptive** test asserting the corrected behavior (the bug must NOT happen), and characterization scoped only to the behaviors you intend to keep. *(This exact error was caught in document-review of the 2026-06-13 scroll/voice plan — characterization scenario was rewritten to "preserved behaviors ONLY.")*
- **Test behavior at a seam, never source strings.** NEVER write a test that `readFileSync`s a source file and asserts on its contents. These test structure, not behavior, and break on every refactor. To verify wiring, exercise the behavior instead. (CLAUDE.md TDD Protocol.)
- **Pick the narrowest valuable seam.** Test the controller/store interface, not private implementation details. One failure should yield one diagnosis. For a race, assert the two races separately if two mechanisms guard them — collapsing them into one assertion hides which mechanism regressed.
- **Watch it fail for the right reason.** A red test that fails because of a typo or a missing import is not a red test. Confirm the failure is the assertion you care about before implementing.

## Plan-authoring corollary

When a plan drives the work, every feature-bearing unit must name its red-test unit *before* its implementation unit, with enumerated scenarios specific enough that the implementer does not invent coverage. Verify the plan against current code first — a plan unit for already-implemented work (a stale architecture-review snapshot) wastes a TDD cycle on a test that is already green. Reality-check the referenced code before writing the red test.

## See also

- `CLAUDE.md` → CE Workflow → Hard Rules 3–4 and TDD Protocol (single source of truth).
- `docs/plans/2026-06-13-002-refactor-decompose-stateful-spines-plan.md` and `-003-refactor-voice-session-controller-plan.md` — red-first units with the characterization guardrail applied.
- `docs/solutions/best-practices/reactive-state-async-callbacks-svelte-2026-04-15.md` — the async-callback race class these tests target.
