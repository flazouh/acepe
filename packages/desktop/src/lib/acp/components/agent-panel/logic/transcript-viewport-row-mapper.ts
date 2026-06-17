import type {
	AgentPanelSceneEntryModel,
	AgentToolStatus,
} from "@acepe/ui/agent-panel";
import type {
	OperationState,
	TranscriptSegment,
	TranscriptViewportRow,
} from "../../../../services/acp-types.js";
import { buildUserRowSceneModel } from "../../../logic/user-row-scene-model.js";
import { transcriptSegmentPrimaryText } from "../../../session-state/transcript-text.js";

export function segmentText(segments: readonly TranscriptSegment[]): string {
	let text = "";
	for (const segment of segments) {
		text += transcriptSegmentPrimaryText(segment);
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

function withViewportPlanningTiming(
	entry: AgentPanelSceneEntryModel,
	row: TranscriptViewportRow
): AgentPanelSceneEntryModel {
	const durationStartedAtMs = row.durationStartedAtMs;
	if (durationStartedAtMs === null || durationStartedAtMs === undefined) {
		return entry;
	}

	if (entry.type === "thinking") {
		if (entry.startedAtMs !== null && entry.startedAtMs !== undefined) {
			return entry;
		}
		return {
			id: entry.id,
			type: entry.type,
			durationMs: entry.durationMs ?? null,
			startedAtMs: durationStartedAtMs,
			label: entry.label,
		};
	}

	if (entry.type === "assistant") {
		if (entry.planningStartedAtMs !== null && entry.planningStartedAtMs !== undefined) {
			return entry;
		}
		if (entry.isStreaming !== true) {
			return entry;
		}
		return {
			id: entry.id,
			type: entry.type,
			markdown: entry.markdown,
			message: entry.message,
			isStreaming: entry.isStreaming,
			tokenRevealCss: entry.tokenRevealCss,
			timestampMs: entry.timestampMs,
			planningStartedAtMs: durationStartedAtMs,
		};
	}

	return entry;
}

export function resolveTranscriptViewportSceneEntry(
	row: TranscriptViewportRow,
	sceneEntryById: ReadonlyMap<string, AgentPanelSceneEntryModel>,
	sceneEntryByToolCallId: ReadonlyMap<string, AgentPanelSceneEntryModel> = new Map()
): AgentPanelSceneEntryModel {
	const canonicalEntry = sceneEntryById.get(row.sourceEntryId);
	if (canonicalEntry !== undefined) {
		return withViewportPlanningTiming(canonicalEntry, row);
	}

	const linkedToolCallId = row.operationLinks[0]?.toolCallId;
	if (linkedToolCallId !== undefined) {
		const canonicalToolEntry = sceneEntryByToolCallId.get(linkedToolCallId);
		if (canonicalToolEntry !== undefined) {
			return canonicalToolEntry;
		}
	}

	if (row.kind === "awaitingPlaceholder") {
		return {
			id: row.sourceEntryId,
			type: "thinking",
			durationMs: null,
			startedAtMs: row.durationStartedAtMs ?? null,
		};
	}

	if (row.content.kind === "transcript" && row.content.role === "user") {
		const userRow = buildUserRowSceneModel({
			entryId: row.sourceEntryId,
			role: "user",
			segments: row.content.segments,
		});
		return {
			id: row.sourceEntryId,
			type: "user",
			text: userRow.text,
			chunks: userRow.chunks.length > 0 ? userRow.chunks : undefined,
		};
	}

	if (row.content.kind === "transcript" && row.content.role === "assistant") {
		return {
			id: row.sourceEntryId,
			type: "assistant",
			markdown: segmentText(row.content.segments.filter((segment) => segment.kind === "text")),
			message: {
				chunks: row.content.segments.flatMap((segment) => {
					if (segment.kind === "localCommand") {
						return [];
					}
					return [
						{
							type: segment.kind === "thought" ? "thought" : "message",
							block: {
								type: "text",
								text: segment.text,
							},
						},
					];
				}),
			},
			isStreaming: row.activeStreamingTail !== null,
			planningStartedAtMs: row.durationStartedAtMs ?? null,
		};
	}

	const operation = row.operationLinks[0];
	return {
		id: row.sourceEntryId,
		type: "tool_call",
		toolCallId: operation?.toolCallId,
		operationId: operation?.operationId,
		kind: "other",
		title: operation?.name ?? "Tool",
		status: operation === undefined ? "degraded" : toolStatusFromOperationState(operation.state),
		presentationState: operation === undefined ? "degraded_operation" : "resolved",
		degradedReason: operation === undefined ? "Viewport row has no linked operation." : null,
		resultText: row.content.kind === "transcript" ? segmentText(row.content.segments) : null,
	};
}
