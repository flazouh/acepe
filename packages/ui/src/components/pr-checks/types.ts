export type PrChecksItemStatus = "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "UNKNOWN";

export type PrChecksItemConclusion =
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

export interface PrChecksItem {
	readonly name: string;
	readonly status: PrChecksItemStatus;
	readonly conclusion: PrChecksItemConclusion | null;
	readonly detailsUrl: string | null;
	readonly startedAt: string | null;
	readonly completedAt: string | null;
	readonly workflowName: string | null;
}
