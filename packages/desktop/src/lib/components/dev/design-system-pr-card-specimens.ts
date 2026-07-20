import type { AgentPanelPrCardModel, PrChecksItem } from "@acepe/ui";

export interface PrCardComponentLink {
	readonly id: string;
	readonly name: string;
	readonly layer: "View" | "Controller" | "Model";
	readonly location: string;
	readonly role: string;
}

export interface PrChecksSummarySpecimen {
	readonly id: string;
	readonly label: string;
	readonly caption: string;
	readonly checks: readonly PrChecksItem[];
	readonly isLoading?: boolean;
	readonly hasResolved?: boolean;
	readonly initiallyExpanded?: boolean;
}

export interface PrCardSpecimen {
	readonly id: string;
	readonly label: string;
	readonly caption: string;
	readonly model: AgentPanelPrCardModel;
	readonly initiallyExpanded?: boolean;
	readonly initiallyExpandedChecks?: boolean;
}

export const prCardSectionMeta = {
	title: "PR card",
	description:
		"Pull-request status above modified files and in the agent panel. CI summaries use labeled counts (for example, 2 failed · 5 passed) instead of repeating the total.",
};

export const prCardComponentLinks: readonly PrCardComponentLink[] = [
	{
		id: "agent-panel-pr-card",
		name: "AgentPanelPrCard",
		layer: "View",
		location: "packages/ui/src/components/agent-panel/agent-panel-pr-card.svelte",
		role: "Full PR card: header, CI checks, description, commits.",
	},
	{
		id: "pr-status-card-shell",
		name: "AgentPanelPrStatusCard",
		layer: "View",
		location: "packages/ui/src/components/agent-panel/pr-status-card.svelte",
		role: "Collapsible shell shared by the PR card header and expanded body.",
	},
	{
		id: "pr-checks-list",
		name: "PrChecksList",
		layer: "View",
		location: "packages/ui/src/components/pr-checks/pr-checks-list.svelte",
		role: "Expandable CI check rows plus labeled summary row.",
	},
	{
		id: "pr-checks-summary",
		name: "PrChecksSummary",
		layer: "View",
		location: "packages/ui/src/components/pr-checks/pr-checks-summary.svelte",
		role: "Compact CI tone dot for kanban cards and session rows.",
	},
	{
		id: "pr-status-card-controller",
		name: "PrStatusCard",
		layer: "Controller",
		location: "packages/desktop/src/lib/acp/components/pr-status-card/pr-status-card.svelte",
		role: "Desktop wrapper: fetches PR details, wires Tauri actions, renders AgentPanelPrCard.",
	},
	{
		id: "ci-job-modal",
		name: "CiJobModal",
		layer: "Controller",
		location: "packages/desktop/src/lib/acp/components/pr-status-card/ci-job-modal.svelte",
		role: "CI job step viewer opened from a failed check row.",
	},
	{
		id: "pr-checks-surface",
		name: "PrChecksSurface",
		layer: "Controller",
		location: "packages/desktop/src/lib/acp/components/shared/pr-checks-surface.svelte",
		role: "Registers visible PR surfaces so CI polling stays active.",
	},
	{
		id: "diff-pill",
		name: "DiffPill",
		layer: "View",
		location: "packages/ui/src/components/diff-pill/",
		role: "Insertion/deletion counts in the PR card header.",
	},
	{
		id: "github-badge",
		name: "GitHubBadge",
		layer: "View",
		location: "packages/ui/src/components/github-badge/",
		role: "Commit SHA pill in the expanded commit list.",
	},
];

function mockCheck(
	name: string,
	status: PrChecksItem["status"],
	conclusion: PrChecksItem["conclusion"]
): PrChecksItem {
	return {
		name,
		status,
		conclusion,
		detailsUrl: "https://github.com/flazouh/acepe/actions/runs/1",
		startedAt: "2026-06-30T10:00:00.000Z",
		completedAt: status === "COMPLETED" ? "2026-06-30T10:04:12.000Z" : null,
		workflowName: "CI",
	};
}

function mockChecks(
	items: ReadonlyArray<{
		name: string;
		status: PrChecksItem["status"];
		conclusion: PrChecksItem["conclusion"];
	}>
): readonly PrChecksItem[] {
	return items.map((item) => mockCheck(item.name, item.status, item.conclusion));
}

const allFailedChecks = mockChecks([
	{ name: "Typecheck", status: "COMPLETED", conclusion: "FAILURE" },
	{ name: "Unit tests", status: "COMPLETED", conclusion: "FAILURE" },
	{ name: "Lint", status: "COMPLETED", conclusion: "FAILURE" },
	{ name: "Rust clippy", status: "COMPLETED", conclusion: "FAILURE" },
	{ name: "UI boundary", status: "COMPLETED", conclusion: "FAILURE" },
	{ name: "E2E smoke", status: "COMPLETED", conclusion: "FAILURE" },
	{ name: "Build", status: "COMPLETED", conclusion: "FAILURE" },
]);

const mixedChecks = mockChecks([
	{ name: "Typecheck", status: "COMPLETED", conclusion: "FAILURE" },
	{ name: "Unit tests", status: "COMPLETED", conclusion: "FAILURE" },
	{ name: "Lint", status: "COMPLETED", conclusion: "SUCCESS" },
	{ name: "Rust clippy", status: "COMPLETED", conclusion: "SUCCESS" },
	{ name: "UI boundary", status: "COMPLETED", conclusion: "SUCCESS" },
	{ name: "E2E smoke", status: "COMPLETED", conclusion: "SUCCESS" },
	{ name: "Build", status: "COMPLETED", conclusion: "SUCCESS" },
]);

const allPassedChecks = mockChecks([
	{ name: "Typecheck", status: "COMPLETED", conclusion: "SUCCESS" },
	{ name: "Unit tests", status: "COMPLETED", conclusion: "SUCCESS" },
	{ name: "Lint", status: "COMPLETED", conclusion: "SUCCESS" },
]);

const runningChecks = mockChecks([
	{ name: "Typecheck", status: "IN_PROGRESS", conclusion: null },
	{ name: "Unit tests", status: "IN_PROGRESS", conclusion: null },
	{ name: "Lint", status: "IN_PROGRESS", conclusion: null },
]);

const runningWithFailureChecks = mockChecks([
	{ name: "Typecheck", status: "COMPLETED", conclusion: "FAILURE" },
	{ name: "Unit tests", status: "IN_PROGRESS", conclusion: null },
	{ name: "Lint", status: "IN_PROGRESS", conclusion: null },
]);

const neutralChecks = mockChecks([
	{ name: "Docs preview", status: "COMPLETED", conclusion: "SKIPPED" },
	{ name: "Release notes", status: "COMPLETED", conclusion: "NEUTRAL" },
]);

const basePrModel = {
	mode: "pr" as const,
	number: 1284,
	title: "Improve CI summary labels on PR card",
	state: "OPEN" as const,
	additions: 148,
	deletions: 36,
	descriptionMarkdown:
		"Replace ambiguous `7 · 7 checks` copy with labeled buckets such as `2 failed · 5 passed`.",
	commits: [
		{
			sha: "a1b2c3d",
			message: "Label CI summary segments",
			insertions: 92,
			deletions: 18,
		},
		{
			sha: "d4e5f6a",
			message: "Add PR card design system specimens",
			insertions: 56,
			deletions: 18,
		},
	],
	hasResolvedChecks: true,
	checksCollapseThreshold: 3,
};

export const prChecksSummarySpecimens: readonly PrChecksSummarySpecimen[] = [
	{
		id: "all-failed",
		label: "All failed",
		caption: "7 failed",
		checks: allFailedChecks,
		hasResolved: true,
		initiallyExpanded: false,
	},
	{
		id: "mixed",
		label: "Mixed",
		caption: "2 failed · 5 passed",
		checks: mixedChecks,
		hasResolved: true,
		initiallyExpanded: false,
	},
	{
		id: "all-passed",
		label: "All passed",
		caption: "3 passed",
		checks: allPassedChecks,
		hasResolved: true,
	},
	{
		id: "running",
		label: "Running",
		caption: "3 running",
		checks: runningChecks,
		hasResolved: true,
	},
	{
		id: "running-with-failure",
		label: "Running with failure",
		caption: "1 failed · 2 running",
		checks: runningWithFailureChecks,
		hasResolved: true,
	},
	{
		id: "neutral",
		label: "Neutral only",
		caption: "2 neutral",
		checks: neutralChecks,
		hasResolved: true,
	},
	{
		id: "waiting",
		label: "Waiting for CI",
		caption: "Resolved PR with no checks yet",
		checks: [],
		hasResolved: true,
	},
	{
		id: "loading",
		label: "Loading",
		caption: "Checks request in flight",
		checks: [],
		isLoading: true,
		hasResolved: false,
	},
];

export const prCardSpecimens: readonly PrCardSpecimen[] = [
	{
		id: "mixed-expanded",
		label: "Open PR · mixed CI",
		caption: "Default agent-panel presentation with expandable description and commits.",
		model: {
			mode: "pr",
			number: basePrModel.number,
			title: basePrModel.title,
			state: basePrModel.state,
			additions: basePrModel.additions,
			deletions: basePrModel.deletions,
			descriptionMarkdown: basePrModel.descriptionMarkdown,
			commits: basePrModel.commits,
			hasResolvedChecks: basePrModel.hasResolvedChecks,
			checksCollapseThreshold: basePrModel.checksCollapseThreshold,
			checks: mixedChecks,
		},
		initiallyExpanded: true,
	},
	{
		id: "all-failed",
		label: "Open PR · all checks failed",
		caption: "Summary collapses to a single labeled bucket when every check shares the outcome.",
		model: {
			mode: "pr",
			number: basePrModel.number,
			title: basePrModel.title,
			state: basePrModel.state,
			additions: basePrModel.additions,
			deletions: basePrModel.deletions,
			descriptionMarkdown: basePrModel.descriptionMarkdown,
			commits: basePrModel.commits,
			hasResolvedChecks: basePrModel.hasResolvedChecks,
			checksCollapseThreshold: basePrModel.checksCollapseThreshold,
			checks: allFailedChecks,
		},
		initiallyExpandedChecks: true,
	},
	{
		id: "streaming",
		label: "Streaming generation",
		caption: "Title and description stream in before the PR exists on GitHub.",
		model: {
			mode: "streaming",
			title: "Add labeled CI summaries",
			descriptionMarkdown: "Streaming body copy while the agent drafts the PR…",
			isStreaming: true,
			generatingLabel: "Generating PR…",
		},
		initiallyExpanded: true,
	},
	{
		id: "creating",
		label: "Creating PR",
		caption: "Spinner state while GitHub creates the pull request.",
		model: {
			mode: "creating",
			number: 1284,
			creatingLabel: "Creating PR…",
		},
	},
];

export const featuredPrCardSpecimen: PrCardSpecimen = prCardSpecimens[0];

export const featuredCiJobCheck: PrChecksItem = mixedChecks[0];

export const featuredCiJobDetails = {
	id: 987654,
	name: "Typecheck",
	status: "completed",
	conclusion: "failure",
	steps: [
		{
			number: 1,
			name: "Set up job",
			status: "completed",
			conclusion: "success",
			log: "Runner provisioned.",
		},
		{
			number: 2,
			name: "Install dependencies",
			status: "completed",
			conclusion: "success",
			log: "bun install completed.",
		},
		{
			number: 3,
			name: "Typecheck",
			status: "completed",
			conclusion: "failure",
			log: "error TS2322: Type 'string' is not assignable to type 'number'.",
		},
	],
};
