import type { HugeiconsIconName } from "./hugeicons-icon-registry.js";

export type PullRequestGitHubState = "open" | "closed" | "merged";

export type PullRequestStatusIconName =
	| "git-pull-request"
	| "check-circle"
	| "x-circle"
	| "refresh"
	| "warning";

export const pullRequestStatusIcons = {
	draft: "git-pull-request",
	open: "git-pull-request",
	merged: "check-circle",
	closed: "x-circle",
	mergeQueued: "refresh",
	changesRequested: "warning",
	inReview: "git-pull-request",
	blocked: "warning",
} as const satisfies Record<string, PullRequestStatusIconName>;

export type PullRequestStatusKind = keyof typeof pullRequestStatusIcons;

export function mapGitHubPrStateToStatusIcon(
	state: PullRequestGitHubState,
): PullRequestStatusIconName {
	switch (state) {
		case "merged":
			return pullRequestStatusIcons.merged;
		case "closed":
			return pullRequestStatusIcons.closed;
		case "open":
			return pullRequestStatusIcons.open;
	}
}

export function mapUppercasePrStateToStatusIcon(
	state: "OPEN" | "CLOSED" | "MERGED",
): PullRequestStatusIconName {
	switch (state) {
		case "MERGED":
			return pullRequestStatusIcons.merged;
		case "CLOSED":
			return pullRequestStatusIcons.closed;
		case "OPEN":
			return pullRequestStatusIcons.open;
	}
}

export function isPullRequestStatusIconName(
	name: HugeiconsIconName,
): name is PullRequestStatusIconName {
	return Object.values(pullRequestStatusIcons).includes(name as PullRequestStatusIconName);
}
