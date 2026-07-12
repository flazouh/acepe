/**
 * Pure transcript-entry → text/message helpers, extracted from the canonical
 * agent-panel graph materializer. Leaf functions depending only on
 * TranscriptEntry — no canonical state, no side effects. GOD-safe.
 */
import type { TranscriptEntry } from "../../services/acp-types.js";
import type { TranscriptSegment } from "../../services/acp-types.js";

export function transcriptSegmentPrimaryText(segment: TranscriptSegment): string {
	if (
		segment.kind === "text" ||
		segment.kind === "thought" ||
		segment.kind === "pastedContent"
	) {
		return segment.text;
	}
	if (segment.kind === "compaction") {
		return segment.event.summary ?? "";
	}
	if (segment.stdout.length > 0) {
		return segment.stdout;
	}
	if (segment.command.length > 0) {
		return segment.command;
	}
	return segment.message;
}

export function transcriptSegmentLegacyUserText(segment: TranscriptSegment): string {
	if (segment.kind === "localCommand") {
		return `<command-name>${segment.command}</command-name><command-message>${segment.message}</command-message><command-args>${segment.args}</command-args><local-command-stdout>${segment.stdout}</local-command-stdout>`;
	}
	if (segment.kind === "text") {
		return segment.text;
	}
	return "";
}

export function segmentText(entry: TranscriptEntry): string {
	let text = "";
	for (const segment of entry.segments) {
		if (text.length > 0 && entry.role !== "assistant") {
			text += "\n";
		}
		if (segment.kind === "text" || segment.kind === "thought") {
			text += segment.text;
		} else if (segment.kind === "localCommand") {
			text += transcriptSegmentPrimaryText(segment);
		}
	}
	return text;
}

export function assistantMarkdownText(entry: TranscriptEntry): string {
	let text = "";
	for (const segment of entry.segments) {
		if (segment.kind === "text") {
			text += segment.text;
		}
	}

	return text;
}

export function buildAssistantMessageFromTranscriptEntry(entry: TranscriptEntry) {
	const chunks: Array<{
		readonly type: "thought" | "message";
		readonly block: {
			readonly type: "text";
			readonly text: string;
		};
	}> = [];
	for (const segment of entry.segments) {
		if (segment.kind === "localCommand" || segment.kind === "compaction") {
			continue;
		}
		chunks.push({
			type: segment.kind === "thought" ? "thought" : "message",
			block: {
				type: "text",
				text: segment.text,
			},
		});
	}
	return {
		chunks,
	};
}
