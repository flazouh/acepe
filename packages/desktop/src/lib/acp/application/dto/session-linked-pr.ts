export type SessionPrLinkMode = "automatic" | "manual";

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
	};
}
