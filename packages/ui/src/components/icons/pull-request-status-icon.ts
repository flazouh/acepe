import type { LinearIconName } from "./linear-icon-catalog.js";

export type PullRequestGitHubState = "open" | "closed" | "merged";

export type PullRequestLinearStatusIconName =
	| "pull-request-status"
	| "pull-request-status-variant2"
	| "pull-request-status-variant3"
	| "pull-request-status-variant4"
	| "pull-request-status-variant5"
	| "pull-request-status-variant6"
	| "pull-request-status-variant7"
	| "pull-request-status-variant8";

export const pullRequestLinearStatusIcons = {
	draft: "pull-request-status",
	open: "pull-request-status-variant4",
	merged: "pull-request-status-variant2",
	closed: "pull-request-status-variant5",
	mergeQueued: "pull-request-status-variant8",
	changesRequested: "pull-request-status-variant3",
	inReview: "pull-request-status-variant6",
	blocked: "pull-request-status-variant7",
} as const satisfies Record<string, PullRequestLinearStatusIconName>;

export type PullRequestLinearStatusKind = keyof typeof pullRequestLinearStatusIcons;

export function mapGitHubPrStateToLinearStatusIcon(
	state: PullRequestGitHubState,
): PullRequestLinearStatusIconName {
	switch (state) {
		case "merged":
			return pullRequestLinearStatusIcons.merged;
		case "closed":
			return pullRequestLinearStatusIcons.closed;
		case "open":
			return pullRequestLinearStatusIcons.open;
	}
}

export function mapUppercasePrStateToLinearStatusIcon(
	state: "OPEN" | "CLOSED" | "MERGED",
): PullRequestLinearStatusIconName {
	switch (state) {
		case "MERGED":
			return pullRequestLinearStatusIcons.merged;
		case "CLOSED":
			return pullRequestLinearStatusIcons.closed;
		case "OPEN":
			return pullRequestLinearStatusIcons.open;
	}
}

export function isPullRequestLinearStatusIconName(
	name: LinearIconName,
): name is PullRequestLinearStatusIconName {
	return (
		name === pullRequestLinearStatusIcons.draft ||
		name === pullRequestLinearStatusIcons.open ||
		name === pullRequestLinearStatusIcons.merged ||
		name === pullRequestLinearStatusIcons.closed ||
		name === pullRequestLinearStatusIcons.mergeQueued ||
		name === pullRequestLinearStatusIcons.changesRequested ||
		name === pullRequestLinearStatusIcons.inReview ||
		name === pullRequestLinearStatusIcons.blocked
	);
}
