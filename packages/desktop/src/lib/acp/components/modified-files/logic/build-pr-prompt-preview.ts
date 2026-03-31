import * as Diff from "diff";
import type { ModifiedFileEntry } from "../../../types/modified-file-entry.js";
import { makeWorkspaceRelative } from "../../../utils/path-utils.js";

export const DEFAULT_SHIP_INSTRUCTIONS = `Generate a git commit message and pull request description for these changes.

Focus on what changed, why it matters, the most important implementation details,
and how it was verified. Keep the commit subject concise and imperative, and make
the PR description easy for a reviewer to scan while still providing a deep,
reviewer-friendly explanation.`;

const SHIP_RESPONSE_FORMAT = `Respond in this EXACT XML format — no other text outside the tags:

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
</ship>`;

interface BuildPrPromptPreviewInput {
	branch: string;
	projectPath: string;
	modifiedFiles: readonly ModifiedFileEntry[];
	customInstructions?: string;
}

export function buildPrPromptPreview({
	branch,
	projectPath,
	modifiedFiles,
	customInstructions,
}: BuildPrPromptPreviewInput): string {
	const instructions = resolveInstructions(customInstructions);
	const summary = buildModifiedFilesSummary(modifiedFiles, projectPath);
	const patch = buildModifiedFilesPatch(modifiedFiles, projectPath);

	return `${instructions}\n\n${SHIP_RESPONSE_FORMAT}\n\nCurrent branch: ${branch}\n\nStaged files:\n${summary}\n\nDiff:\n${patch}`;
}

function resolveInstructions(customInstructions: string | undefined): string {
	if (customInstructions && customInstructions.trim().length > 0) {
		return customInstructions;
	}

	return DEFAULT_SHIP_INSTRUCTIONS;
}

function buildModifiedFilesSummary(
	modifiedFiles: readonly ModifiedFileEntry[],
	projectPath: string,
): string {
	return modifiedFiles
		.map((file) => `${getGitStatus(file)}\t${getRelativeFilePath(file.filePath, projectPath)}`)
		.join("\n");
}

function buildModifiedFilesPatch(
	modifiedFiles: readonly ModifiedFileEntry[],
	projectPath: string,
): string {
	return modifiedFiles
		.map((file) => buildSingleFilePatch(file, projectPath))
		.filter((patch) => patch.length > 0)
		.join("\n");
}

function buildSingleFilePatch(file: ModifiedFileEntry, projectPath: string): string {
	const relativePath = getRelativeFilePath(file.filePath, projectPath);
	const previousContent = file.originalContent !== null ? file.originalContent : "";
	const nextContent = file.finalContent !== null ? file.finalContent : "";
	const structuredPatch = Diff.structuredPatch(
		relativePath,
		relativePath,
		previousContent,
		nextContent,
		"",
		"",
		{ context: 3 },
	);

	if (structuredPatch.hunks.length === 0) {
		return "";
	}

	const oldPath = file.originalContent === null ? "/dev/null" : `a/${relativePath}`;
	const newPath = file.finalContent === null ? "/dev/null" : `b/${relativePath}`;
	const gitHeader = `diff --git a/${relativePath} b/${relativePath}`;
	const fileHeaders = `--- ${oldPath}\n+++ ${newPath}`;
	const hunks = structuredPatch.hunks
		.map((hunk) => {
			const header = `@@ -${formatHunkRange(hunk.oldStart, hunk.oldLines)} +${formatHunkRange(hunk.newStart, hunk.newLines)} @@`;
			return `${header}\n${hunk.lines.join("\n")}`;
		})
		.join("\n");

	return `${gitHeader}\n${fileHeaders}\n${hunks}`;
}

function formatHunkRange(start: number, lineCount: number): string {
	if (lineCount === 1) {
		return `${start}`;
	}

	return `${start},${lineCount}`;
}

function getRelativeFilePath(filePath: string, projectPath: string): string {
	return makeWorkspaceRelative(filePath, projectPath);
}

function getGitStatus(file: ModifiedFileEntry): "A" | "D" | "M" {
	if (file.originalContent === null) {
		return "A";
	}

	if (file.finalContent === null) {
		return "D";
	}

	return "M";
}