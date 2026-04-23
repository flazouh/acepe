export type SessionPrLinkMode = "automatic" | "manual";

export type SessionPrCheckStatus = "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "UNKNOWN";

export type SessionPrCheckConclusion =
	| "SUCCESS"
	| "FAILURE"
	| "NEUTRAL"
	| "CANCELLED"
	| "SKIPPED"
	| "TIMED_OUT"
	| "ACTION_REQUIRED"
	| "STALE"
	| "STARTUP_FAILURE"
	| "UNKNOWN";

export interface SessionPrCheckRun {
	readonly name: string;
	readonly status: SessionPrCheckStatus;
	readonly conclusion: SessionPrCheckConclusion | null;
	readonly detailsUrl: string | null;
	readonly startedAt: string | null;
	readonly completedAt: string | null;
	readonly workflowName: string | null;
}

export interface SessionLinkedPr {
	readonly prNumber: number;
	readonly state: "OPEN" | "CLOSED" | "MERGED";
	readonly url: string | null;
	readonly title: string | null;
	readonly additions: number | null;
	readonly deletions: number | null;
	readonly isDraft: boolean | null;
	readonly isLoading: boolean;
	readonly hasResolvedDetails: boolean;
	readonly checksHeadSha: string | null;
	readonly checks: readonly SessionPrCheckRun[];
	readonly isChecksLoading: boolean;
	readonly hasResolvedChecks: boolean;
}

export function buildPartialSessionLinkedPr(
	prNumber: number,
	state: SessionLinkedPr["state"] | undefined
): SessionLinkedPr {
	return {
		prNumber,
		state: state ?? "OPEN",
		url: null,
		title: null,
		additions: null,
		deletions: null,
		isDraft: null,
		isLoading: true,
		hasResolvedDetails: false,
		checksHeadSha: null,
		checks: [],
		isChecksLoading: true,
		hasResolvedChecks: false,
	};
}
