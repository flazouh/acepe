import {
	toolCallIdFromEntry,
	type SessionEntry,
	userMessageIdFromEntry,
} from "$lib/acp/application/dto/session-entry.js";
import type {
	TranscriptEntry,
	TranscriptSegment,
	TranscriptSnapshot,
} from "$lib/services/acp-types.js";
import {
	transcriptSegmentLegacyUserText,
	transcriptSegmentPrimaryText,
} from "$lib/acp/session-state/transcript-text.js";
import type {
	ContentBlock,
	ToolCallData,
	ToolCallStatus,
	ToolKind,
} from "$lib/services/converted-session-types.js";

// Transcript tool entries are ordering spine only. Rich tool semantics come from
// canonical operations and graph scene materialization, not from this DTO.

function toContentBlock(text: string): ContentBlock {
	return {
		type: "text",
		text,
	};
}

function segmentText(entry: TranscriptEntry): string {
	let text = "";
	for (const segment of entry.segments) {
		const segmentTextValue =
			entry.role === "user" && segment.kind === "localCommand"
				? transcriptSegmentLegacyUserText(segment)
				: transcriptSegmentPrimaryText(segment);
		text = text.length === 0 ? segmentTextValue : `${text}\n${segmentTextValue}`;
	}
	return text;
}

function segmentBlocks(entry: TranscriptEntry): ContentBlock[] {
	const blocks: ContentBlock[] = [];
	for (const segment of entry.segments) {
		const segmentTextValue =
			entry.role === "user" && segment.kind === "localCommand"
				? transcriptSegmentLegacyUserText(segment)
				: transcriptSegmentPrimaryText(segment);
		blocks.push(toContentBlock(segmentTextValue));
	}
	return blocks;
}

function toTranscriptToolSpineMessage(entry: TranscriptEntry): ToolCallData {
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
): SessionEntry | null {
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
		const chunks: Array<{
			type: "thought" | "message";
			block: ContentBlock;
		}> = [];
		for (const segment of entry.segments) {
			if (segment.kind === "localCommand" || segment.kind === "compaction") {
				continue;
			}
			chunks.push({
				type: segment.kind === "thought" ? "thought" : "message",
				block: toContentBlock(segment.text),
			});
		}
		return {
			id: entry.entryId,
			type: "assistant",
			message: {
				chunks,
			},
			timestamp,
		};
	}

	if (entry.role === "tool") {
		return {
			id: entry.entryId,
			type: "tool_call",
			message: toTranscriptToolSpineMessage(entry),
			timestamp,
		};
	}

	return null;
}

export function appendTranscriptSegmentToSessionEntry(
	entry: SessionEntry,
	segment: TranscriptSegment
): SessionEntry | null {
	if (entry.type === "assistant") {
		if (segment.kind === "localCommand" || segment.kind === "compaction") {
			return null;
		}
		const nextChunks = entry.message.chunks.concat([
			{
				type: segment.kind === "thought" ? "thought" : "message",
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
		const segmentTextValue =
			segment.kind === "localCommand"
				? transcriptSegmentLegacyUserText(segment)
				: transcriptSegmentPrimaryText(segment);
		const mergedText =
			entry.message.content.type === "text"
				? `${entry.message.content.text}\n${segmentTextValue}`
				: segmentTextValue;
		const nextBlock = toContentBlock(segmentTextValue);
		const nextChunks = entry.message.chunks.concat([nextBlock]);
		return {
			id: entry.id,
			type: "user",
			message: {
				id: userMessageIdFromEntry(entry),
				content: toContentBlock(mergedText),
				chunks: nextChunks,
				sentAt: entry.message.sentAt,
				checkpoint: entry.message.checkpoint,
			},
			timestamp: entry.timestamp,
			isStreaming: entry.isStreaming,
		};
	}

	if (entry.type === "tool_call") {
		const segmentTextValue = transcriptSegmentPrimaryText(segment);
		const previousTitle = entry.message.title ?? entry.message.name;
		const nextTitle =
			previousTitle.length > 0 ? `${previousTitle}\n${segmentTextValue}` : segmentTextValue;
		return {
			id: entry.id,
			type: "tool_call",
			message: {
				id: toolCallIdFromEntry(entry),
				name: nextTitle.length > 0 ? nextTitle : entry.message.name,
				arguments: entry.message.arguments,
				progressiveArguments: entry.message.progressiveArguments,
				status: entry.message.status,
				result: entry.message.result,
				kind: entry.message.kind,
				title: nextTitle.length > 0 ? nextTitle : entry.message.title,
				locations: entry.message.locations,
				skillMeta: entry.message.skillMeta,
				normalizedQuestions: entry.message.normalizedQuestions,
				normalizedTodos: entry.message.normalizedTodos,
				parentToolUseId: entry.message.parentToolUseId,
				taskChildren: entry.message.taskChildren,
				questionAnswer: entry.message.questionAnswer,
				awaitingPlanApproval: entry.message.awaitingPlanApproval,
				planApprovalRequestId: entry.message.planApprovalRequestId,
				normalizedResult: entry.message.normalizedResult,
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
	const entries: SessionEntry[] = [];
	for (const entry of snapshot.entries) {
		const sessionEntry = convertTranscriptEntryToSessionEntry(entry, timestamp);
		if (sessionEntry !== null) {
			entries.push(sessionEntry);
		}
	}
	return entries;
}
