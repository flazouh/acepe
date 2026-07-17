import { describe, expect, it } from "bun:test";
import type {
	TranscriptScope,
	TranscriptViewportRow,
} from "../../../../../services/acp-types.js";
import type { TaskTranscriptDialogState } from "../task-transcript-dialog-controller.svelte.js";
import { taskTranscriptDialogPresentation } from "../task-transcript-dialog-presentation.js";
import { taskTranscriptDialogIdentity } from "../task-transcript-dialog-controller.svelte.js";

const scope: TranscriptScope = {
	kind: "operation",
	operationId: "operation-task-1",
};

function transcriptRow(input: {
	readonly rowId: string;
	readonly thought: boolean;
	readonly text: string;
}): TranscriptViewportRow {
	return {
		rowId: input.rowId,
		sourceEntryId: `${input.rowId}:entry`,
		scope,
		kind: input.thought ? "assistantThought" : "assistantText",
		version: `${input.rowId}:v1`,
		anchorEligible: true,
		activeStreamingTail: null,
		operationLinks: [],
		interactionLinks: [],
		content: {
			kind: "transcript",
			role: "assistant",
			segments: [
				input.thought
					? { kind: "thought", segmentId: `${input.rowId}:segment`, text: input.text }
					: { kind: "text", segmentId: `${input.rowId}:segment`, text: input.text },
			],
		},
	};
}

describe("taskTranscriptDialogPresentation", () => {
	it("maps scoped rows one-for-one in canonical order with stable row ids", () => {
		const identity = taskTranscriptDialogIdentity({
			sessionId: "session-1",
			panelId: "panel-1",
			rootRowId: "root-task-row",
			operationId: "operation-task-1",
		});
		const state: TaskTranscriptDialogState = {
			identity,
			scope,
			revision: {
				graphRevision: 11,
				transcriptRevision: 7,
				lastEventSeq: 13,
			},
			open: true,
			status: "ready",
			rows: [
				transcriptRow({ rowId: "thought-row", thought: true, text: "Thinking" }),
				transcriptRow({ rowId: "final-row", thought: false, text: "Done" }),
			],
			totalRowCount: 2,
			hasMore: false,
			errorMessage: null,
		};

		const presentation = taskTranscriptDialogPresentation(state);

		expect(presentation.rows.map((row) => row.rowId)).toEqual([
			"thought-row",
			"final-row",
		]);
		expect(presentation.rows.map((row) => row.entry.type)).toEqual([
			"assistant",
			"assistant",
		]);
	});
});
