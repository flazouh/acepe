import {
	getReviewWorkspaceDefaultIndex,
	type AgentPanelFileReviewStatus,
	type ReviewWorkspaceFileItem,
} from "@acepe/ui/agent-panel";

import { sessionReviewStateStore } from "../../../store/session-review-state-store.svelte.js";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import { getReviewStatusByFilePath } from "../../modified-files/logic/review-progress.js";
import type { FileReviewStatus } from "../../review-panel/review-session-state.js";

function mapReviewStatus(status: FileReviewStatus | undefined): AgentPanelFileReviewStatus {
	if (status === "accepted" || status === "partial" || status === "denied") {
		return status;
	}

	return "unreviewed";
}

export function buildReviewWorkspaceFiles(
	filesState: ModifiedFilesState,
	statusByFilePath: ReadonlyMap<string, FileReviewStatus | undefined>
): ReviewWorkspaceFileItem[] {
	return filesState.files.map((file) => ({
		id: file.filePath,
		filePath: file.filePath,
		fileName: file.fileName,
		reviewStatus: mapReviewStatus(statusByFilePath.get(file.filePath)),
		additions: file.totalAdded,
		deletions: file.totalRemoved,
	}));
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
	return (
		getReviewWorkspaceDefaultIndex(
			buildReviewWorkspaceFilesFromSessionState(filesState, sessionId)
		) ?? 0
	);
}
