//! Prompt templates for AI-generated commit messages and PR descriptions.
//!
//! The agent responds in XML format (`<ship>...</ship>`) which the frontend
//! parses incrementally during streaming to render the ShipCard component.

use crate::git::operations::StagedContext;

/// Default instructions for the PR description prompt.
///
/// Kept as a constant so the frontend can display it as a customisable
/// starting point while the actual context (branch, diff) is appended at
/// generation time.
pub const DEFAULT_SHIP_INSTRUCTIONS: &str = r#"Generate a git commit message and pull request description for the following staged changes.

Respond in this EXACT XML format — no other text outside the tags:

<ship>
<commit-message>
Subject line here (imperative mood, ≤72 chars, no trailing period, conventional commit prefix)

Optional body explaining WHY (not what).
</commit-message>
<pr-title>PR title here (≤72 chars, no trailing period)</pr-title>
<pr-description>
## Summary
Provide a detailed explanation of the changes: what they accomplish, why they
were needed, and how the different parts fit together.

When the change involves a non-trivial flow (data pipelines, request
lifecycles, state machines, etc.), include an ASCII diagram:

```
  ┌──────────┐      ┌──────────┐      ┌──────────┐
  │  Input   │─────▶│ Process  │─────▶│  Output  │
  └──────────┘      └──────────┘      └──────────┘
```

Use the appropriate diagram style for the situation:
- Sequence diagrams for request/response flows
- Flowcharts for branching logic
- Tree diagrams for hierarchical structures
- Data-flow diagrams for pipelines

## Changes
- **`path/to/file.ts`** (+N -N) — brief description
(list files with meaningful changes, skip lockfiles and generated files)

## Testing
1. Step-by-step verification instructions
2. Expected behavior for the happy path
3. Edge cases to check
</pr-description>
</ship>"#;

/// Build a prompt that instructs the agent to respond with commit message
/// and PR description in XML format for the ShipCard generative UI.
///
/// When `custom_instructions` is provided it replaces the default
/// instructions block; the branch / staged-files / diff context is always
/// appended.
pub fn build_ship_prompt(
    branch: &str,
    context: &StagedContext,
    custom_instructions: Option<&str>,
) -> String {
    let instructions = custom_instructions.unwrap_or(DEFAULT_SHIP_INSTRUCTIONS);
    format!(
        "{instructions}\n\nCurrent branch: {branch}\n\nStaged files:\n{summary}\n\nDiff:\n{patch}",
        instructions = instructions,
        branch = branch,
        summary = context.summary,
        patch = context.patch,
    )
}
