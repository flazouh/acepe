import type {
	SessionLinkedPr,
	SessionPrLinkMode,
	SessionPrLinkReference,
} from "$lib/acp/application/dto/session-linked-pr.js";
import type { PrListItem } from "$lib/acp/types/github-integration.js";

export function getLinkedPrTooltipLabel(linkedPr: SessionLinkedPr | null): string {
	return linkedPr ? `#${linkedPr.prNumber}` : "Link pull request";
}

export function getHeaderPrLinkLabel(linkedPr: SessionLinkedPr | null): string {
	return linkedPr ? `Linked to #${linkedPr.prNumber}` : "Link existing PR";
}

export function getSessionPrLinkMenuTriggerLabel(
	linkedPr: SessionLinkedPr | null | undefined
): string {
	return linkedPr ? "Change linked pull request" : "Link pull request";
}

export function getSessionPrLinkMenuStatusLabel(input: {
	readonly linkedPr: SessionLinkedPr | null | undefined;
	readonly prLinkMode: SessionPrLinkMode | null | undefined;
}): string {
	if (!input.linkedPr) {
		return "No linked pull request";
	}

	const modeLabel = input.prLinkMode === "manual" ? "Manual" : "Automatic";
	return `${modeLabel} link to #${input.linkedPr.prNumber}`;
}

export type PrPickerListState =
	| { readonly kind: "loading"; readonly message: "Loading pull requests..." }
	| { readonly kind: "error"; readonly message: string }
	| { readonly kind: "empty"; readonly message: "No open pull requests in this repository" }
	| { readonly kind: "items"; readonly pullRequests: readonly PrListItem[] };

export function groupSessionPrLinksByNumber(
	references: readonly SessionPrLinkReference[]
): ReadonlyMap<number, readonly SessionPrLinkReference[]> {
	const map = new Map<number, SessionPrLinkReference[]>();
	for (const reference of references) {
		const existing = map.get(reference.prNumber);
		if (existing) {
			existing.push(reference);
		} else {
			map.set(reference.prNumber, [reference]);
		}
	}
	return map;
}

export function filterPullRequestsByQuery(
	pullRequests: readonly PrListItem[],
	query: string
): readonly PrListItem[] {
	const normalizedQuery = query.trim().toLowerCase();
	if (normalizedQuery === "") return pullRequests;

	return pullRequests.filter((pr) => {
		return (
			pr.title.toLowerCase().includes(normalizedQuery) ||
			pr.author.toLowerCase().includes(normalizedQuery) ||
			`#${pr.number}`.includes(normalizedQuery)
		);
	});
}

export function shouldLoadOpenPullRequests(input: {
	projectPath: string;
	loadedProjectPath: string | null;
	loading: boolean;
	loadingProjectPath: string | null;
}): boolean {
	if (input.loadedProjectPath === input.projectPath) return false;
	if (input.loading && input.loadingProjectPath === input.projectPath) return false;
	return true;
}

export function shouldShowPrSearchInput(openPullRequestCount: number): boolean {
	return openPullRequestCount >= 10;
}

export function normalizePrListItemState(
	state: PrListItem["state"]
): SessionLinkedPr["state"] {
	switch (state) {
		case "merged":
			return "MERGED";
		case "closed":
			return "CLOSED";
		case "open":
			return "OPEN";
	}
}

export function getPrPickerListState(input: {
	readonly loading: boolean;
	readonly loadError: string | null;
	readonly filteredPullRequests: readonly PrListItem[];
}): PrPickerListState {
	if (input.loading) {
		return { kind: "loading", message: "Loading pull requests..." };
	}
	if (input.loadError) {
		return { kind: "error", message: input.loadError };
	}
	if (input.filteredPullRequests.length === 0) {
		return { kind: "empty", message: "No open pull requests in this repository" };
	}
	return { kind: "items", pullRequests: input.filteredPullRequests };
}
