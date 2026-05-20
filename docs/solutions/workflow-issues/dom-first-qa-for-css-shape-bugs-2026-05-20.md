---
title: DOM-first QA for CSS shape bugs
date: 2026-05-20
category: docs/solutions/workflow-issues
module: visual QA workflow
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - Fixing borders, rounded corners, overlays, or attached UI surfaces
  - A UI shape is made from multiple DOM elements
  - Screenshot checks are ambiguous or have already missed the bug
symptoms:
  - A screenshot-based QA pass misses a missing border or wrong radius
  - The agent keeps changing CSS by guessing from pixels
  - The user has to point out what the screenshot already shows
root_cause: weak_feedback_loop
resolution_type: workflow_improvement
tags: [dom-qa, visual-qa, css, permissions, workflow]
---

# DOM-first QA for CSS shape bugs

## Context

During the attached permission-button work, the UI was not a simple card. It was one visual shape made from two DOM areas: the tool call and the permission button shelf.

Screenshot-only QA was too weak. It hid the real problem: the tool card had no bottom border on the right, and its bottom-right corner was no longer rounded.

## Guidance

For CSS shape bugs, inspect the DOM before claiming the UI is fixed.

Check the exact elements that create the shape:

1. Which element owns the main card border?
2. Which element owns the attached shelf border?
3. Which element draws the missing edge between them?
4. What are the computed `border-*`, `border-radius`, `background-color`, and element rect values?

Only use a screenshot after DOM QA, as a final human-facing sanity check.

The DOM state must also be deterministic. Prefer a real visible instance of the broken UI. If the current app does not have one, inject a temporary DOM fixture into the dev WebView that uses the app's loaded CSS classes, measure it, then remove it. Do not inspect a random current screen state and treat that as proof.

## Why This Matters

If two elements are pretending to be one shape, normal CSS borders often fight each other. Removing a border from one element can also remove a border that is still needed somewhere else.

DOM QA catches that directly. A screenshot can show that something looks wrong, but DOM QA tells us which element is responsible.

## Rule

When the user reports a border, radius, attached-surface, or masking problem, first prove the shape in DOM terms. Do not keep guessing from screenshots.

For attached surfaces, include explicit geometry checks:

- the shelf does not span the full card width
- the main card keeps any far-side border and radius it still owns
- the shelf owns only its compact surface
- no unrelated filler element draws decorative border art elsewhere
