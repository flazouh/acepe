//! Prompt templates for AI-generated commit messages and PR descriptions.
//!
//! The agent responds in XML format (`<ship>...</ship>`) which the frontend
//! parses incrementally during streaming to render the ShipCard component.

use crate::git::operations::StagedContext;

/// Default user-facing instructions for PR generation.
///
/// This is the only part we expose for editing in the frontend. The XML
/// response contract and git diff context are appended internally.
pub const DEFAULT_SHIP_INSTRUCTIONS: &str = r#"Generate a git commit message and pull request description for these changes.

Focus on what changed, why it matters, the most important implementation details,
and how it was verified. Keep the commit subject concise and imperative, and make
the PR description easy for a reviewer to scan while still providing a deep,
reviewer-friendly explanation."#;

const SHIP_RESPONSE_FORMAT: &str = r#"Respond in this EXACT XML format — no other text outside the tags:

<ship>
<commit-message>
Subject line here (imperative mood, ≤72 chars, no trailing period, conventional commit prefix)

Optional body explaining WHY (not what).
</commit-message>
<pr-title>PR title here (≤72 chars, no trailing period)</pr-title>
<pr-description>
## Abstract
Write a short executive summary in 2-4 sentences. State the core change, why it
matters, and the main reviewer takeaway.

## Problem
Explain the problem in depth before describing the fix. Cover the previous
behavior, why it was insufficient, and the concrete impact on users, reviewers,
or maintainers.

Include an ASCII diagram that shows the current behavior, failure mode,
or system shape before the fix:

```
    ┌──────────┐      ┌──────────┐      ┌──────────┐
    │  Input   │─────▶│ Process  │─────▶│  Output  │
    └──────────┘      └──────────┘      └──────────┘
```

Include a concrete before/after example for the problem statement, such as:

- Input/output before the fix
- Reviewer-visible behavior before the change
- A small scenario that demonstrates the failure clearly

Use the appropriate diagram style for the situation:
- Sequence diagrams for request/response flows
- Flowcharts for branching logic
- Tree diagrams for hierarchical structures
- Data-flow diagrams for pipelines

## Solution
Explain how the implementation solves the problem, why this approach was chosen,
and how the main pieces work together.

Include an ASCII diagram that shows the new flow, architecture, or decision path
after the fix:

```
    ┌──────────┐      ┌────────────┐      ┌──────────┐
    │  Input   │─────▶│ New logic  │─────▶│  Output  │
    └──────────┘      └────────────┘      └──────────┘
```

Include a concrete before/after example that makes the solution obvious in
practice.

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
/// When `custom_instructions` is provided it replaces only the editable user
/// guidance. The XML response contract plus branch / staged-files / diff
/// context are always appended internally.
pub fn build_ship_prompt(
    branch: &str,
    context: &StagedContext,
    custom_instructions: Option<&str>,
) -> String {
    let instructions = custom_instructions.unwrap_or(DEFAULT_SHIP_INSTRUCTIONS);
    format!(
        "{instructions}\n\n{response_format}\n\nCurrent branch: {branch}\n\nStaged files:\n{summary}\n\nDiff:\n{patch}",
        instructions = instructions,
        response_format = SHIP_RESPONSE_FORMAT,
        branch = branch,
        summary = context.summary,
        patch = context.patch,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_ship_prompt_keeps_hidden_response_contract() {
        let context = StagedContext {
            summary: "M\tsrc/lib.rs".to_string(),
            patch: "diff --git a/src/lib.rs b/src/lib.rs".to_string(),
        };

        let prompt = build_ship_prompt("feature/default", &context, None);

        assert!(prompt.starts_with(DEFAULT_SHIP_INSTRUCTIONS));
        assert!(prompt.contains("Respond in this EXACT XML format"));
        assert!(prompt.contains("## Abstract"));
        assert!(prompt.contains("## Problem"));
        assert!(prompt.contains("## Solution"));
        assert!(prompt.contains("Explain the problem in depth before describing the fix."));
        assert!(prompt
            .contains("Include an ASCII diagram that shows the current behavior, failure mode,"));
        assert!(prompt.contains("Include a concrete before/after example"));
        assert!(prompt.contains("Current branch: feature/default"));
        assert!(prompt.contains("Diff:\ndiff --git a/src/lib.rs b/src/lib.rs"));
    }

    #[test]
    fn build_ship_prompt_preserves_hidden_contract_with_custom_instructions() {
        let context = StagedContext {
            summary: "M\tsrc/lib.rs".to_string(),
            patch: "diff --git a/src/lib.rs b/src/lib.rs".to_string(),
        };

        let prompt =
            build_ship_prompt("feature/custom", &context, Some("Custom ship instructions"));

        assert!(prompt.starts_with("Custom ship instructions"));
        assert!(!prompt.contains(DEFAULT_SHIP_INSTRUCTIONS));
        assert!(prompt.contains("Respond in this EXACT XML format"));
        assert!(prompt.contains("<ship>"));
    }
}
