import type {
	AgentPanelSceneEntryModel,
	AgentToolReviewFileEntry,
} from "@acepe/ui/agent-panel";
import type { TurnState } from "../../../store/types.js";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";

export const SYNTHETIC_REVIEW_ENTRY_ID = "local:review";

export function createSyntheticReviewEntry(input: {
	readonly turnState: TurnState;
	readonly modifiedFilesState: ModifiedFilesState | null;
}): AgentPanelSceneEntryModel | null {
	if (
		input.turnState === "streaming" ||
		input.modifiedFilesState === null ||
		input.modifiedFilesState.fileCount === 0
	) {
		return null;
	}

	const reviewFiles: AgentToolReviewFileEntry[] = input.modifiedFilesState.files.map((file) => ({
		id: file.filePath,
		filePath: file.filePath,
		fileName: file.fileName,
		additions: file.totalAdded,
		deletions: file.totalRemoved,
	}));

	return {
		id: SYNTHETIC_REVIEW_ENTRY_ID,
		type: "tool_call",
		kind: "review",
		title: "Edited files",
		status: "done",
		reviewFiles,
	};
}
