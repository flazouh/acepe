import type { SessionEntry } from "$lib/acp/application/dto/session.js";
import type {
	ContentBlock,
	ToolCallData,
	ToolCallStatus,
	ToolKind,
} from "$lib/services/converted-session-types.js";
import type {
	TranscriptEntry,
	TranscriptSegment,
	TranscriptSnapshot,
} from "$lib/services/acp-types.js";

function toContentBlock(text: string): ContentBlock {
	return {
		type: "text",
		text,
	};
}

function segmentText(entry: TranscriptEntry): string {
	return entry.segments.map((segment) => segment.text).join("\n");
}

function segmentBlocks(entry: TranscriptEntry): ContentBlock[] {
	return entry.segments.map((segment) => toContentBlock(segment.text));
}

function toToolCallMessage(entry: TranscriptEntry): ToolCallData {
	const title = segmentText(entry);
	const status: ToolCallStatus = "completed";
	const kind: ToolKind = "other";

	return {
		id: entry.entryId,
		name: title.length > 0 ? title : "Tool",
		arguments: {
			kind: "other",
			raw: null,
		},
		rawInput: null,
		status,
		result: null,
		kind,
		title: title.length > 0 ? title : "Tool",
		locations: null,
		skillMeta: null,
		normalizedQuestions: null,
		normalizedTodos: null,
		parentToolUseId: null,
		taskChildren: null,
		questionAnswer: null,
		awaitingPlanApproval: false,
		planApprovalRequestId: null,
	};
}

export function convertTranscriptEntryToSessionEntry(
	entry: TranscriptEntry,
	timestamp: Date
): SessionEntry {
	if (entry.role === "user") {
		const blocks = segmentBlocks(entry);
		return {
			id: entry.entryId,
			type: "user",
			message: {
				id: entry.entryId,
				content: toContentBlock(segmentText(entry)),
				chunks: blocks,
			},
			timestamp,
		};
	}

	if (entry.role === "assistant") {
		return {
			id: entry.entryId,
			type: "assistant",
			message: {
				chunks: entry.segments.map((segment) => ({
					type: "message" as const,
					block: toContentBlock(segment.text),
				})),
			},
			timestamp,
		};
	}

	if (entry.role === "tool") {
		return {
			id: entry.entryId,
			type: "tool_call",
			message: toToolCallMessage(entry),
			timestamp,
		};
	}

	return {
		id: entry.entryId,
		type: "error",
		message: {
			content: segmentText(entry),
		},
		timestamp,
	};
}

export function appendTranscriptSegmentToSessionEntry(
	entry: SessionEntry,
	segment: TranscriptSegment
): SessionEntry | null {
	if (entry.type === "assistant") {
		const nextChunks = entry.message.chunks.concat([
			{
				type: "message",
				block: toContentBlock(segment.text),
			},
		]);
		return {
			id: entry.id,
			type: "assistant",
			message: {
				chunks: nextChunks,
			},
			timestamp: entry.timestamp,
			isStreaming: entry.isStreaming,
		};
	}

	if (entry.type === "user") {
		const mergedText =
			entry.message.content.type === "text"
				? `${entry.message.content.text}\n${segment.text}`
				: segment.text;
		const nextBlock = toContentBlock(segment.text);
		const nextChunks = entry.message.chunks.concat([nextBlock]);
		return {
			id: entry.id,
			type: "user",
			message: {
				id: entry.message.id,
				content: toContentBlock(mergedText),
				chunks: nextChunks,
				sentAt: entry.message.sentAt,
				checkpoint: entry.message.checkpoint,
			},
			timestamp: entry.timestamp,
			isStreaming: entry.isStreaming,
		};
	}

	if (entry.type === "error") {
		return {
			id: entry.id,
			type: "error",
			message: {
				content: `${entry.message.content}\n${segment.text}`,
				code: entry.message.code,
				kind: entry.message.kind,
				source: entry.message.source,
			},
			timestamp: entry.timestamp,
			isStreaming: entry.isStreaming,
		};
	}

	return null;
}

export function convertTranscriptSnapshotToSessionEntries(
	snapshot: TranscriptSnapshot,
	timestamp: Date
): SessionEntry[] {
	return snapshot.entries.map((entry) => convertTranscriptEntryToSessionEntry(entry, timestamp));
}
