---
title: Visual QA screenshot evidence must be shown and described before claiming pass
date: 2026-05-20
category: docs/solutions/workflow-issues
module: visual QA workflow
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - Verifying UI-visible changes from a screenshot
  - The UI includes approval, permission, tool-call, or safety controls
  - The user cannot see the exact screenshot the agent is judging
symptoms:
  - Agent claims visual QA passed without showing the screenshot
  - Screenshot actually shows the same bug or a worse UX
  - Permission or approval UI loses important context
root_cause: missing_workflow_step
resolution_type: workflow_improvement
tags: [visual-qa, screenshots, permissions, evidence, workflow]
---

# Visual QA screenshot evidence must be shown and described before claiming pass

## Context

During permission-bar QA, the agent claimed the fix was confirmed from a screenshot. The user had not seen that screenshot. When the screenshot was shown later, it still had a bad UI: the tool row only said `Access`, and the approval bar had buttons but no useful file or action context.

That made the QA claim wrong. It also made the product worse because the attempted fix removed useful context from the permission bar.

## Guidance

For visual QA, do not say "passed" just because a screenshot exists.

Before claiming success:

1. Show the screenshot or give the exact screenshot path.
2. Describe what is visible in plain words.
3. Check the description against the user's complaint.
4. If the screenshot still shows the bug, call it a failure and fix it.

For permission and approval UI, the bar must always give the user enough context to safely decide. It is not enough to show only `Deny`, `Always`, and `Allow`.

## Why This Matters

Visual QA is supposed to protect the user from broken UI. If the agent does not describe the screenshot, it can miss obvious problems and still report success.

This is a major QA violation because it creates false confidence. The user has to re-check the work, which defeats the purpose of having the agent QA it.

## When to Apply

- Any UI fix where the final proof is a screenshot
- Any stateful UI where nearby rows, labels, or controls can be confused
- Any permission, approval, safety, or tool-call UI
- Any time the screenshot is not already visible to the user

## Example

Bad QA report:

```text
Visual QA passed. The duplicate label is gone.
```

Why this is bad: it does not say what is actually visible. It can hide the fact that useful context disappeared too.

Better QA report:

```text
Screenshot shows session 45. The tool row says only "Access".
The permission bar shows Deny, Always, and Allow, but it does not show the file path.
That is not a pass because the user cannot tell what they are approving.
```

## Rule

If the screenshot cannot be clearly described as solving the exact user complaint, visual QA did not pass.

When in doubt, show the screenshot first and ask the user to confirm the visual judgment before committing the fix.
