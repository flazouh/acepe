//! Prompt templates for AI-generated commit messages and PR descriptions.
//!
//! The agent responds in XML format (`<ship>...</ship>`) which the frontend
//! parses incrementally during streaming to render the ShipCard component.

use crate::git::operations::StagedContext;

/// Build a prompt that instructs the agent to respond with commit message
/// and PR description in XML format for the ShipCard generative UI.
pub fn build_ship_prompt(branch: &str, context: &StagedContext) -> String {
    format!(
        r#"Generate a git commit message and pull request description for the following staged changes.

Respond in this EXACT XML format — no other text outside the tags:

<ship>
<commit-message>
Subject line here (imperative mood, ≤72 chars, no trailing period, conventional commit prefix)

Optional body explaining WHY (not what).
</commit-message>
<pr-title>PR title here (≤72 chars, no trailing period)</pr-title>
<pr-description>
## Summary
- 2-5 bullet points explaining what changed and why
- Focus on the "why" — the diff shows the "what"

## Changes
- **`path/to/file.ts`** (+N -N) — brief description
(list files with meaningful changes, skip lockfiles)

## Testing
1. Step-by-step verification
2. Expected behavior
3. Edge cases to check
</pr-description>
</ship>

Current branch: {branch}

Staged files:
{summary}

Diff:
{patch}"#,
        branch = branch,
        summary = context.summary,
        patch = context.patch,
    )
}
