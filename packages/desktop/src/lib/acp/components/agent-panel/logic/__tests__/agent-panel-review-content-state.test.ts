import { describe, expect, it } from "bun:test";

import type { PersistedFileReviewProgress } from "$lib/acp/store/session-review-state-store.svelte.js";
import type { PerFileReviewState } from "$lib/acp/components/review-panel/review-session-state.js";

import {
	appendResolvedHunkAction,
	buildFallbackHunkAcceptStats,
	buildFallbackHunkRejectStats,
	buildPersistableReviewProgressInput,
	buildReviewHunkNavigationSummary,
	buildReviewHydrationSignature,
	buildReviewStateFromHunkStats,
	findStaleReviewStateKeys,
	mapPersistedProgressToReviewState,
	resolveAgentPanelReviewKeyAction,
	resolveCurrentFileReviewState,
	resolveReviewHydrationAction,
	resolveReviewAutoAdvanceAction,
} from "../agent-panel-review-content-state.js";

function state(overrides: Partial<PerFileReviewState> = {}): PerFileReviewState {
	return {
		filePath: "src/app.ts",
		status: "partial",
		acceptedHunks: 0,
		rejectedHunks: 0,
		pendingHunks: 1,
		totalHunks: 1,
		...overrides,
	};
}

describe("agent-panel review content state", () => {
	it("maps persisted progress to local review state", () => {
		const progress: PersistedFileReviewProgress = {
			filePath: "src/app.ts",
			status: "accepted",
			acceptedHunks: 2,
			rejectedHunks: 0,
			pendingHunks: 0,
			totalHunks: 2,
			resolvedActions: [],
		};

		expect(mapPersistedProgressToReviewState(progress)).toEqual({
			filePath: "src/app.ts",
			status: "accepted",
			acceptedHunks: 2,
			rejectedHunks: 0,
			pendingHunks: 0,
			totalHunks: 2,
		});
	});

	it("prefers completed persisted state over local state", () => {
		const local = state({
			status: "partial",
			acceptedHunks: 1,
			rejectedHunks: 0,
			pendingHunks: 1,
			totalHunks: 2,
		});
		const persisted: PersistedFileReviewProgress = {
			filePath: "src/app.ts",
			status: "accepted",
			acceptedHunks: 2,
			rejectedHunks: 0,
			pendingHunks: 0,
			totalHunks: 2,
			resolvedActions: [],
		};

		expect(resolveCurrentFileReviewState({ local, persisted })).toEqual({
			filePath: "src/app.ts",
			status: "accepted",
			acceptedHunks: 2,
			rejectedHunks: 0,
			pendingHunks: 0,
			totalHunks: 2,
		});
	});

	it("uses local state before incomplete persisted state", () => {
		const local = state({ acceptedHunks: 1 });
		const persisted: PersistedFileReviewProgress = {
			filePath: "src/app.ts",
			status: "partial",
			acceptedHunks: 0,
			rejectedHunks: 0,
			pendingHunks: 2,
			totalHunks: 2,
			resolvedActions: [],
		};

		expect(resolveCurrentFileReviewState({ local, persisted })).toBe(local);
		expect(resolveCurrentFileReviewState({ local: undefined, persisted })).toEqual({
			filePath: "src/app.ts",
			status: "partial",
			acceptedHunks: 0,
			rejectedHunks: 0,
			pendingHunks: 2,
			totalHunks: 2,
		});
	});

	it("appends resolved hunk actions without mutating the existing list", () => {
		const existing = [{ hunkIndex: 1, action: "accept" as const }];
		const next = appendResolvedHunkAction(existing, { hunkIndex: 2, action: "reject" });

		expect(next).toEqual([
			{ hunkIndex: 1, action: "accept" },
			{ hunkIndex: 2, action: "reject" },
		]);
		expect(existing).toEqual([{ hunkIndex: 1, action: "accept" }]);
	});

	it("builds persistable review progress input", () => {
		expect(
			buildPersistableReviewProgressInput({
				status: state({ status: "accepted", acceptedHunks: 2, pendingHunks: 0, totalHunks: 2 }),
				resolvedActions: [{ hunkIndex: 0, action: "accept" }],
			})
		).toEqual({
			filePath: "src/app.ts",
			status: "accepted",
			acceptedHunks: 2,
			rejectedHunks: 0,
			pendingHunks: 0,
			totalHunks: 2,
			resolvedActions: [{ hunkIndex: 0, action: "accept" }],
		});
	});

	it("builds review state from hunk stats", () => {
		expect(
			buildReviewStateFromHunkStats({
				filePath: "src/app.ts",
				stats: {
					accepted: 2,
					rejected: 0,
					pending: 0,
					total: 2,
				},
			})
		).toEqual({
			filePath: "src/app.ts",
			status: "accepted",
			acceptedHunks: 2,
			rejectedHunks: 0,
			pendingHunks: 0,
			totalHunks: 2,
		});
	});

	it("builds fallback accept and reject stats from previous state", () => {
		const previous = state({
			acceptedHunks: 1,
			rejectedHunks: 1,
			pendingHunks: 3,
			totalHunks: 5,
		});

		expect(buildFallbackHunkAcceptStats(previous)).toEqual({
			accepted: 2,
			rejected: 1,
			pending: 2,
			total: 5,
		});
		expect(buildFallbackHunkRejectStats(previous)).toEqual({
			accepted: 1,
			rejected: 2,
			pending: 2,
			total: 5,
		});
	});

	it("stays when the file is not fully resolved", () => {
		expect(
			resolveReviewAutoAdvanceAction({
				resolvedState: state({ pendingHunks: 1, totalHunks: 2 }),
				resolvedIndex: 0,
				fileStates: [state({ pendingHunks: 1, totalHunks: 2 })],
			})
		).toEqual({ kind: "stay" });
	});

	it("selects the next reviewable file or closes when none remains", () => {
		expect(
			resolveReviewAutoAdvanceAction({
				resolvedState: state({ pendingHunks: 0, totalHunks: 1, status: "accepted" }),
				resolvedIndex: 0,
				fileStates: [
					state({ pendingHunks: 0, totalHunks: 1, status: "accepted" }),
					state({ pendingHunks: 2, totalHunks: 2 }),
				],
			})
		).toEqual({ kind: "select", index: 1 });

		expect(
			resolveReviewAutoAdvanceAction({
				resolvedState: state({ pendingHunks: 0, totalHunks: 1, status: "accepted" }),
				resolvedIndex: 0,
				fileStates: [state({ pendingHunks: 0, totalHunks: 1, status: "accepted" })],
			})
		).toEqual({ kind: "close" });
	});

	it("builds hunk navigation summary from pending and active hunks", () => {
		expect(
			buildReviewHunkNavigationSummary({
				stats: { total: 5, pending: 3 },
				pendingHunkIndices: [1, 3, 4],
				activeHunkIndex: 3,
				selectedFileIsResolved: false,
				selectedFileTotalHunks: null,
			})
		).toEqual({
			hasPrev: true,
			hasNext: true,
			hasPending: true,
			hunkCurrent: 2,
			hunkTotal: 3,
		});
	});

	it("uses total hunks when there are no pending hunks", () => {
		expect(
			buildReviewHunkNavigationSummary({
				stats: { total: 5, pending: 0 },
				pendingHunkIndices: [],
				activeHunkIndex: null,
				selectedFileIsResolved: true,
				selectedFileTotalHunks: 7,
			})
		).toEqual({
			hasPrev: false,
			hasNext: false,
			hasPending: false,
			hunkCurrent: 0,
			hunkTotal: 7,
		});
	});

	it("resolves review keyboard actions", () => {
		expect(resolveAgentPanelReviewKeyAction({ isActive: false, key: "Escape", metaKey: false }))
			.toEqual({ kind: "none" });
		expect(resolveAgentPanelReviewKeyAction({ isActive: true, key: "Escape", metaKey: false }))
			.toEqual({ kind: "close" });
		expect(resolveAgentPanelReviewKeyAction({ isActive: true, key: "ArrowRight", metaKey: true }))
			.toEqual({ kind: "next-file" });
		expect(resolveAgentPanelReviewKeyAction({ isActive: true, key: "y", metaKey: true })).toEqual({
			kind: "accept-first-pending-hunk",
			preventDefault: true,
		});
		expect(resolveAgentPanelReviewKeyAction({ isActive: true, key: "n", metaKey: true })).toEqual({
			kind: "reject-first-pending-hunk",
			preventDefault: true,
		});
	});

	it("builds and resolves review hydration signatures", () => {
		expect(
			buildReviewHydrationSignature({
				sessionId: "session-1",
				fileRevisionKeySignature: "a\u0000b",
			})
		).toBe("session-1\u0000a\u0000b");

		expect(
			resolveReviewHydrationAction({
				sessionId: null,
				isLoaded: false,
				fileRevisionKeySignature: "a",
				hydratedRevisionSignature: "old",
			})
		).toEqual({ kind: "reset" });
		expect(
			resolveReviewHydrationAction({
				sessionId: "session-1",
				isLoaded: false,
				fileRevisionKeySignature: "a",
				hydratedRevisionSignature: null,
			})
		).toEqual({ kind: "skip" });
		expect(
			resolveReviewHydrationAction({
				sessionId: "session-1",
				isLoaded: true,
				fileRevisionKeySignature: "a",
				hydratedRevisionSignature: "session-1\u0000a",
			})
		).toEqual({ kind: "skip" });
		expect(
			resolveReviewHydrationAction({
				sessionId: "session-1",
				isLoaded: true,
				fileRevisionKeySignature: "b",
				hydratedRevisionSignature: "session-1\u0000a",
			})
		).toEqual({ kind: "hydrate", signature: "session-1\u0000b" });
	});

	it("finds stale review state keys", () => {
		expect(
			findStaleReviewStateKeys({
				existingKeys: ["a", "b", "c"],
				validKeys: new Set(["a", "c"]),
			})
		).toEqual(["b"]);
	});
});
