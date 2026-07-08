import {
	type AgentPanelFileReviewStatus,
	getReviewWorkspaceDefaultIndex,
	type ReviewWorkspaceFileItem,
} from "@acepe/ui/agent-panel";

import { sessionReviewStateStore } from "../../../store/session-review-state-store.svelte.js";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import { getReviewStatusByFilePath } from "../../modified-files/logic/review-progress.js";
import type { FileReviewStatus } from "../../review-panel/review-session-state.js";

function mapReviewStatus(status: FileReviewStatus | undefined): AgentPanelFileReviewStatus {
	if (status === "reviewed") {
		return "reviewed";
	}

	return "unreviewed";
}

function getReviewStatusOrder(status: AgentPanelFileReviewStatus | undefined): number {
	// Unreviewed files sort first so review focus lands on remaining work.
	if (status === "unreviewed" || status === undefined) {
		return 0;
	}

	return 1;
}

export function buildReviewWorkspaceFiles(
	filesState: ModifiedFilesState,
	statusByFilePath: ReadonlyMap<string, FileReviewStatus | undefined>
): ReviewWorkspaceFileItem[] {
	const rows = filesState.files.map((file, sourceIndex) => ({
		id: file.filePath,
		filePath: file.filePath,
		fileName: file.fileName,
		sourceIndex,
		reviewStatus: mapReviewStatus(statusByFilePath.get(file.filePath)),
		additions: file.totalAdded,
		deletions: file.totalRemoved,
	}));

	rows.sort((left, right) => {
		const rankDelta =
			getReviewStatusOrder(left.reviewStatus) - getReviewStatusOrder(right.reviewStatus);
		if (rankDelta !== 0) {
			return rankDelta;
		}

		return left.sourceIndex - right.sourceIndex;
	});

	return rows;
}

export function buildReviewWorkspaceFilesFromSessionState(
	filesState: ModifiedFilesState,
	sessionId?: string | null
): ReviewWorkspaceFileItem[] {
	if (!sessionId || !sessionReviewStateStore.isLoaded(sessionId)) {
		return buildReviewWorkspaceFiles(filesState, new Map<string, FileReviewStatus | undefined>());
	}

	return buildReviewWorkspaceFiles(
		filesState,
		getReviewStatusByFilePath(filesState.files, sessionReviewStateStore.getState(sessionId))
	);
}

export function resolveInitialReviewWorkspaceIndex(
	filesState: ModifiedFilesState,
	sessionId?: string | null
): number {
	const rows = buildReviewWorkspaceFilesFromSessionState(filesState, sessionId);
	const defaultDisplayIndex = getReviewWorkspaceDefaultIndex(rows);
	if (defaultDisplayIndex === null) {
		return 0;
	}

	return rows[defaultDisplayIndex]?.sourceIndex ?? defaultDisplayIndex;
}
