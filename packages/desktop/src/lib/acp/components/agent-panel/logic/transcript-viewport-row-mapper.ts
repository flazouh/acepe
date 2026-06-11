import type {
	AgentPanelSceneEntryModel,
	AgentToolStatus,
} from "@acepe/ui/agent-panel";
import type {
	OperationState,
	TranscriptSegment,
	TranscriptViewportRow,
} from "../../../../services/acp-types.js";

export function segmentText(segments: readonly TranscriptSegment[]): string {
	let text = "";
	for (const segment of segments) {
		text += segment.text;
	}
	return text;
}

export function toolStatusFromOperationState(state: OperationState): AgentToolStatus {
	if (state === "running") {
		return "running";
	}
	if (state === "completed") {
		return "done";
	}
	if (state === "failed") {
		return "error";
	}
	if (state === "blocked") {
		return "blocked";
	}
	if (state === "cancelled") {
		return "cancelled";
	}
	if (state === "degraded") {
		return "degraded";
	}
	return "pending";
}

export function resolveTranscriptViewportSceneEntry(
	row: TranscriptViewportRow,
	sceneEntryById: ReadonlyMap<string, AgentPanelSceneEntryModel>
): AgentPanelSceneEntryModel {
	const canonicalEntry = sceneEntryById.get(row.sourceEntryId);
	if (canonicalEntry !== undefined) {
		return canonicalEntry;
	}

	if (row.kind === "awaitingPlaceholder") {
		return {
			id: row.sourceEntryId,
			type: "thinking",
			durationMs: null,
		};
	}

	if (row.content.kind === "transcript" && row.content.role === "user") {
		return {
			id: row.sourceEntryId,
			type: "user",
			text: segmentText(row.content.segments),
		};
	}

	if (row.content.kind === "transcript" && row.content.role === "assistant") {
		return {
			id: row.sourceEntryId,
			type: "assistant",
			markdown: segmentText(row.content.segments.filter((segment) => segment.kind === "text")),
			message: {
				chunks: row.content.segments.map((segment) => {
					return {
						type: segment.kind === "thought" ? "thought" : "message",
						block: {
							type: "text",
							text: segment.text,
						},
					};
				}),
			},
			isStreaming: row.activeStreamingTail !== null,
		};
	}

	const operation = row.operationLinks[0];
	return {
		id: row.sourceEntryId,
		type: "tool_call",
		toolCallId: operation?.toolCallId,
		operationId: operation?.operationId,
		kind: "other",
		title: operation?.name ?? (row.kind === "error" ? "Error" : "Tool"),
		status: operation === undefined ? "degraded" : toolStatusFromOperationState(operation.state),
		presentationState: operation === undefined ? "degraded_operation" : "resolved",
		degradedReason: operation === undefined ? "Viewport row has no linked operation." : null,
		resultText: row.content.kind === "transcript" ? segmentText(row.content.segments) : null,
	};
}
