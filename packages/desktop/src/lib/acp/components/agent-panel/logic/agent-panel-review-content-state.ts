import type { PersistedFileReviewProgress } from "$lib/acp/store/session-review-state-store.svelte.js";
import type {
	FileReviewCounters,
	PerFileReviewState,
} from "$lib/acp/components/review-panel/review-session-state.js";
import {
	computeFileReviewStatus,
	findNextReviewableFileIndex,
	shouldAutoAdvanceAfterFileResolution,
} from "$lib/acp/components/review-panel/review-session-state.js";

export interface ReviewHunkStats {
	readonly total: number;
	readonly pending: number;
	readonly accepted: number;
	readonly rejected: number;
}

export interface ReviewHunkNavigationSummary {
	readonly hasPrev: boolean;
	readonly hasNext: boolean;
	readonly hasPending: boolean;
	readonly hunkCurrent: number;
	readonly hunkTotal: number;
}

export type AgentPanelReviewKeyAction =
	| { readonly kind: "none" }
	| { readonly kind: "close" }
	| { readonly kind: "next-file" }
	| { readonly kind: "accept-first-pending-hunk"; readonly preventDefault: boolean }
	| { readonly kind: "reject-first-pending-hunk"; readonly preventDefault: boolean };

export type AgentPanelResolvedHunkAction = {
	readonly hunkIndex: number;
	readonly action: "accept" | "reject";
};

export type AgentPanelReviewHydrationAction =
	| { readonly kind: "reset" }
	| { readonly kind: "skip" }
	| { readonly kind: "hydrate"; readonly signature: string };

export function mapPersistedProgressToReviewState(
	progress: PersistedFileReviewProgress
): PerFileReviewState {
	return {
		filePath: progress.filePath,
		status: progress.status,
		acceptedHunks: progress.acceptedHunks,
		rejectedHunks: progress.rejectedHunks,
		pendingHunks: progress.pendingHunks,
		totalHunks: progress.totalHunks,
	};
}

export function resolveCurrentFileReviewState(input: {
	readonly local: PerFileReviewState | undefined;
	readonly persisted: PersistedFileReviewProgress | null;
}): PerFileReviewState | undefined {
	if (input.persisted?.pendingHunks === 0) {
		return mapPersistedProgressToReviewState(input.persisted);
	}

	if (input.local) {
		return input.local;
	}

	return input.persisted ? mapPersistedProgressToReviewState(input.persisted) : undefined;
}

export function appendResolvedHunkAction(
	existing: readonly AgentPanelResolvedHunkAction[] | undefined,
	action: AgentPanelResolvedHunkAction
): readonly AgentPanelResolvedHunkAction[] {
	return [...(existing ?? []), action];
}

export function buildPersistableReviewProgressInput(input: {
	readonly status: PerFileReviewState;
	readonly resolvedActions: readonly AgentPanelResolvedHunkAction[];
}): PersistedFileReviewProgress {
	return {
		filePath: input.status.filePath,
		status: input.status.status,
		acceptedHunks: input.status.acceptedHunks,
		rejectedHunks: input.status.rejectedHunks,
		pendingHunks: input.status.pendingHunks,
		totalHunks: input.status.totalHunks,
		resolvedActions: Array.from(input.resolvedActions),
	};
}

export function buildReviewHydrationSignature(input: {
	readonly sessionId: string;
	readonly fileRevisionKeySignature: string;
}): string {
	return `${input.sessionId}\u0000${input.fileRevisionKeySignature}`;
}

export function resolveReviewHydrationAction(input: {
	readonly sessionId: string | null;
	readonly isLoaded: boolean;
	readonly fileRevisionKeySignature: string;
	readonly hydratedRevisionSignature: string | null;
}): AgentPanelReviewHydrationAction {
	if (!input.sessionId) {
		return { kind: "reset" };
	}

	if (!input.isLoaded) {
		return { kind: "skip" };
	}

	const nextSignature = buildReviewHydrationSignature({
		sessionId: input.sessionId,
		fileRevisionKeySignature: input.fileRevisionKeySignature,
	});
	if (nextSignature === input.hydratedRevisionSignature) {
		return { kind: "skip" };
	}

	return { kind: "hydrate", signature: nextSignature };
}

export function findStaleReviewStateKeys(input: {
	readonly existingKeys: Iterable<string>;
	readonly validKeys: ReadonlySet<string>;
}): string[] {
	const staleKeys: string[] = [];
	for (const key of input.existingKeys) {
		if (!input.validKeys.has(key)) {
			staleKeys.push(key);
		}
	}
	return staleKeys;
}

export function buildReviewStateFromHunkStats(input: {
	readonly filePath: string;
	readonly stats: ReviewHunkStats;
	readonly isDenied?: boolean;
}): PerFileReviewState {
	const counters: FileReviewCounters = {
		acceptedHunks: input.stats.accepted,
		rejectedHunks: input.stats.rejected,
		pendingHunks: input.stats.pending,
		totalHunks: input.stats.total,
	};

	return {
		filePath: input.filePath,
		acceptedHunks: counters.acceptedHunks,
		rejectedHunks: counters.rejectedHunks,
		pendingHunks: counters.pendingHunks,
		totalHunks: counters.totalHunks,
		status: computeFileReviewStatus(counters, input.isDenied === true),
	};
}

export function buildFallbackHunkAcceptStats(
	prev: PerFileReviewState | undefined
): ReviewHunkStats {
	return {
		total: prev?.totalHunks ?? 0,
		pending: (prev?.pendingHunks ?? 1) - 1,
		accepted: (prev?.acceptedHunks ?? 0) + 1,
		rejected: prev?.rejectedHunks ?? 0,
	};
}

export function buildFallbackHunkRejectStats(
	prev: PerFileReviewState | undefined
): ReviewHunkStats {
	return {
		total: prev?.totalHunks ?? 0,
		pending: (prev?.pendingHunks ?? 1) - 1,
		accepted: prev?.acceptedHunks ?? 0,
		rejected: (prev?.rejectedHunks ?? 0) + 1,
	};
}

export function resolveReviewAutoAdvanceAction(input: {
	readonly resolvedState: PerFileReviewState;
	readonly resolvedIndex: number;
	readonly fileStates: ReadonlyArray<PerFileReviewState | undefined>;
}): { readonly kind: "stay" } | { readonly kind: "select"; readonly index: number } | { readonly kind: "close" } {
	if (!shouldAutoAdvanceAfterFileResolution(input.resolvedState)) {
		return { kind: "stay" };
	}

	const nextReviewableIndex = findNextReviewableFileIndex(
		input.resolvedIndex,
		input.fileStates
	);
	if (nextReviewableIndex !== null) {
		return { kind: "select", index: nextReviewableIndex };
	}

	return { kind: "close" };
}

export function buildReviewHunkNavigationSummary(input: {
	readonly stats: Pick<ReviewHunkStats, "total" | "pending"> | null;
	readonly pendingHunkIndices: readonly number[];
	readonly activeHunkIndex: number | null;
	readonly selectedFileIsResolved: boolean;
	readonly selectedFileTotalHunks?: number | null;
}): ReviewHunkNavigationSummary {
	if (input.stats === null) {
		return {
			hasPrev: false,
			hasNext: false,
			hasPending: false,
			hunkCurrent: 0,
			hunkTotal: 0,
		};
	}

	const pending = input.selectedFileIsResolved ? [] : input.pendingHunkIndices;
	const activeIdx = input.activeHunkIndex !== null ? pending.indexOf(input.activeHunkIndex) : 0;
	const hunkCurrent = pending.length > 0 ? activeIdx + 1 : 0;
	const hunkTotal = pending.length || input.selectedFileTotalHunks || input.stats.total;

	return {
		hasPrev: pending.length > 1 && activeIdx > 0,
		hasNext: pending.length > 1 && activeIdx < pending.length - 1 && activeIdx >= 0,
		hasPending: !input.selectedFileIsResolved && input.stats.pending > 0,
		hunkCurrent,
		hunkTotal,
	};
}

export function resolveAgentPanelReviewKeyAction(input: {
	readonly isActive: boolean;
	readonly key: string;
	readonly metaKey: boolean;
}): AgentPanelReviewKeyAction {
	if (!input.isActive) {
		return { kind: "none" };
	}

	if (input.key === "Escape") {
		return { kind: "close" };
	}
	if (input.key === "ArrowRight" && input.metaKey) {
		return { kind: "next-file" };
	}
	if (input.key === "y" && input.metaKey) {
		return { kind: "accept-first-pending-hunk", preventDefault: true };
	}
	if (input.key === "n" && input.metaKey) {
		return { kind: "reject-first-pending-hunk", preventDefault: true };
	}

	return { kind: "none" };
}
