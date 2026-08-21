export const LEGACY_DEFAULT_SHIP_INSTRUCTIONS = `Generate a git commit message and pull request description for these changes.

Focus on what changed, why it matters, the most important implementation details,
and how it was verified. Keep the commit subject concise and imperative, and make
the PR description easy for a reviewer to scan while still providing a deep,
reviewer-friendly explanation.`

export const DEFAULT_SHIP_INSTRUCTIONS = `Generate a git commit message and pull request description for these changes.

Keep the commit subject concise, imperative, and focused on why the change matters.

For the PR description, use this structure:

## Abstract
Write a short executive summary in 2-4 sentences. State the core change, why it
matters, and the main reviewer takeaway.

## Problem
Explain the problem in depth before describing the fix. Cover the previous
behavior, why it was insufficient, and the concrete impact on users, reviewers,
or maintainers.

Include an ASCII diagram that shows the current behavior, failure mode, or
system shape before the fix.

Include a concrete before/after example for the problem statement.

## Solution
Explain how the implementation solves the problem, why this approach was chosen,
and how the main pieces work together.

Include an ASCII diagram that shows the new flow, architecture, or decision path
after the fix.

Include a concrete before/after example that makes the solution obvious in
practice.

## Changes
List the meaningful file-level changes and what each one contributes.

## Testing
Describe step-by-step verification, the expected happy path, and the important
edge cases that were checked.`

export const SHIP_RESPONSE_FORMAT = `Respond in this EXACT XML format — no other text outside the tags:

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

\`\`\`
    ┌──────────┐      ┌──────────┐      ┌──────────┐
    │  Input   │─────▶│ Process  │─────▶│  Output  │
    └──────────┘      └──────────┘      └──────────┘
\`\`\`

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

\`\`\`
    ┌──────────┐      ┌────────────┐      ┌──────────┐
    │  Input   │─────▶│ New logic  │─────▶│  Output  │
    └──────────┘      └────────────┘      └──────────┘
\`\`\`

Include a concrete before/after example that makes the solution obvious in
practice.

## Changes
- **\`path/to/file.ts\`** (+N -N) — brief description
(list files with meaningful changes, skip lockfiles and generated files)

## Testing
1. Step-by-step verification instructions
2. Expected behavior for the happy path
3. Edge cases to check
</pr-description>
</ship>`

export const ACEPE_PR_FOOTER =
	"\n\n---\n\n[![Created with Acepe](https://img.shields.io/badge/Created_with-Acepe-6366f1)](https://acepe.dev)"

export const normalizeCustomInstructions = (customInstructions: string | undefined): string | undefined => {
	if (customInstructions === undefined) {
		return undefined
	}
	const trimmed = customInstructions.trim()
	if (trimmed === "") {
		return undefined
	}
	if (trimmed === DEFAULT_SHIP_INSTRUCTIONS.trim()) {
		return undefined
	}
	if (trimmed === LEGACY_DEFAULT_SHIP_INSTRUCTIONS.trim()) {
		return undefined
	}
	return trimmed
}

export const buildShipPrompt = (
	branch: string,
	summary: string,
	patch: string,
	customInstructions: string | undefined
): string => {
	const instructions = normalizeCustomInstructions(customInstructions) ?? DEFAULT_SHIP_INSTRUCTIONS
	return `${instructions}\n\n${SHIP_RESPONSE_FORMAT}\n\nCurrent branch: ${branch}\n\nStaged files:\n${summary}\n\nDiff:\n${patch}`
}

export const prBodyWithAcepeFooter = (userBody: string | undefined): string => {
	const user = userBody === undefined ? "" : userBody.trim()
	if (user === "") {
		return ACEPE_PR_FOOTER.trimStart()
	}
	return `${user}${ACEPE_PR_FOOTER}`
}
