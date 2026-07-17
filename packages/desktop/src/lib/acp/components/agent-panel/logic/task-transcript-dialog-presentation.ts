import type { AgentTaskDetailPresentation } from "@acepe/ui/agent-panel";
import type { TaskTranscriptDialogState } from "./task-transcript-dialog-controller.svelte.js";
import { resolveTranscriptViewportSceneEntry } from "./transcript-viewport-row-mapper.js";

export function taskTranscriptDialogPresentation(
	state: TaskTranscriptDialogState
): AgentTaskDetailPresentation {
	return {
		open: state.open,
		status: state.status,
		rows: state.rows.map((row) => {
			return {
				rowId: row.rowId,
				entry: resolveTranscriptViewportSceneEntry(row),
			};
		}),
		hasMore: state.hasMore,
		errorMessage: state.errorMessage,
	};
}
