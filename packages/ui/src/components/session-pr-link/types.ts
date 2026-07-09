export type SessionPrLinkPickerPrState = "OPEN" | "CLOSED" | "MERGED";

export type SessionPrLinkPickerMode = "automatic" | "manual";

export interface SessionPrLinkPickerLinkedPr {
	readonly prNumber: number;
	readonly state: SessionPrLinkPickerPrState;
}

export interface SessionPrLinkPickerPullRequest {
	readonly number: number;
	readonly title: string;
	readonly author: string;
	readonly state: "open" | "closed" | "merged";
}

export interface SessionPrLinkPickerReference {
	readonly id: string;
	readonly prNumber: number;
	readonly sequenceId?: number | null;
}

export interface SessionPrLinkPickerProject {
	readonly name: string;
	readonly badgeLabel?: string | null;
	readonly color: string;
	readonly iconPath: string | null;
}

export interface SessionPrLinkPickerRepoContext {
	readonly owner: string;
	readonly repo: string;
}
