import { describe, expect, it } from "bun:test";
import type { SessionPrLinkReference } from "$lib/acp/application/dto/session-linked-pr.js";
import type { PrListItem } from "$lib/acp/types/github-integration.js";

import {
	filterPullRequestsByQuery,
	getHeaderPrLinkLabel,
	getLinkedPrTooltipLabel,
	getPrPickerListState,
	getSessionPrLinkMenuStatusLabel,
	getSessionPrLinkMenuTriggerLabel,
	groupSessionPrLinksByNumber,
	normalizePrListItemState,
	shouldLoadOpenPullRequests,
	shouldShowPrSearchInput,
} from "./pr-link-picker-state.js";

function pr(overrides: Partial<PrListItem>): PrListItem {
	return {
		number: 1,
		title: "Improve queue rendering",
		author: "alex",
		state: "open",
		headRef: "feature",
		baseRef: "main",
		updatedAt: "2026-05-22T00:00:00Z",
		additions: 1,
		deletions: 0,
		changedFiles: 1,
		...overrides,
	};
}

describe("pr link picker state", () => {
	it("builds labels from the linked PR", () => {
		expect(getLinkedPrTooltipLabel(null)).toBe("Link pull request");
		const linkedPr = {
			prNumber: 42,
			state: "OPEN",
			url: null,
			title: null,
			additions: null,
			deletions: null,
			isDraft: null,
			isLoading: false,
			hasResolvedDetails: false,
			checksHeadSha: null,
			checks: [],
			isChecksLoading: false,
			hasResolvedChecks: false,
		} as const;

		expect(getLinkedPrTooltipLabel(linkedPr)).toBe("#42");
		expect(getHeaderPrLinkLabel(null)).toBe("Link existing PR");
		expect(getSessionPrLinkMenuTriggerLabel(null)).toBe("Link pull request");
		expect(getSessionPrLinkMenuTriggerLabel(linkedPr)).toBe("Change linked pull request");
		expect(getSessionPrLinkMenuStatusLabel({ linkedPr: null, prLinkMode: "automatic" })).toBe(
			"No linked pull request"
		);
		expect(getSessionPrLinkMenuStatusLabel({ linkedPr, prLinkMode: "manual" })).toBe(
			"Manual link to #42"
		);
		expect(getSessionPrLinkMenuStatusLabel({ linkedPr, prLinkMode: "automatic" })).toBe(
			"Automatic link to #42"
		);
	});

	it("groups linked sessions by PR number", () => {
		const references: SessionPrLinkReference[] = [
			{ id: "session-1", prNumber: 12, sequenceId: 1 },
			{ id: "session-2", prNumber: 12, sequenceId: 2 },
			{ id: "session-3", prNumber: 13, sequenceId: 3 },
		];

		const grouped = groupSessionPrLinksByNumber(references);

		expect(grouped.get(12)?.map((reference) => reference.id)).toEqual([
			"session-1",
			"session-2",
		]);
		expect(grouped.get(13)?.map((reference) => reference.id)).toEqual(["session-3"]);
	});

	it("filters pull requests by title, author, or number", () => {
		const pullRequests = [
			pr({ number: 12, title: "Improve queue rendering", author: "alex" }),
			pr({ number: 24, title: "Fix settings panel", author: "sam" }),
		];

		expect(filterPullRequestsByQuery(pullRequests, "queue").map((item) => item.number)).toEqual([
			12,
		]);
		expect(filterPullRequestsByQuery(pullRequests, "SAM").map((item) => item.number)).toEqual([
			24,
		]);
		expect(filterPullRequestsByQuery(pullRequests, "#12").map((item) => item.number)).toEqual([
			12,
		]);
		expect(filterPullRequestsByQuery(pullRequests, "  ")).toBe(pullRequests);
	});

	it("skips loading when the project is already loaded or loading", () => {
		expect(
			shouldLoadOpenPullRequests({
				projectPath: "/repo",
				loadedProjectPath: "/repo",
				loading: false,
				loadingProjectPath: null,
			})
		).toBe(false);
		expect(
			shouldLoadOpenPullRequests({
				projectPath: "/repo",
				loadedProjectPath: null,
				loading: true,
				loadingProjectPath: "/repo",
			})
		).toBe(false);
		expect(
			shouldLoadOpenPullRequests({
				projectPath: "/repo",
				loadedProjectPath: null,
				loading: true,
				loadingProjectPath: "/other",
			})
		).toBe(true);
	});

	it("shows search only for larger lists", () => {
		expect(shouldShowPrSearchInput(9)).toBe(false);
		expect(shouldShowPrSearchInput(10)).toBe(true);
	});

	it("normalizes PR list states for session-linked PRs", () => {
		expect(normalizePrListItemState("open")).toBe("OPEN");
		expect(normalizePrListItemState("closed")).toBe("CLOSED");
		expect(normalizePrListItemState("merged")).toBe("MERGED");
	});

	it("builds PR picker list state", () => {
		const pullRequests = [pr({ number: 12 })];

		expect(
			getPrPickerListState({
				loading: true,
				loadError: null,
				filteredPullRequests: pullRequests,
			})
		).toEqual({ kind: "loading", message: "Loading pull requests..." });
		expect(
			getPrPickerListState({
				loading: false,
				loadError: "GitHub failed",
				filteredPullRequests: pullRequests,
			})
		).toEqual({ kind: "error", message: "GitHub failed" });
		expect(
			getPrPickerListState({
				loading: false,
				loadError: null,
				filteredPullRequests: [],
			})
		).toEqual({ kind: "empty", message: "No open pull requests in this repository" });
		expect(
			getPrPickerListState({
				loading: false,
				loadError: null,
				filteredPullRequests: pullRequests,
			})
		).toEqual({ kind: "items", pullRequests });
	});
});
