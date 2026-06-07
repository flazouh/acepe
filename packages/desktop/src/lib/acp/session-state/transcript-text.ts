/**
 * Pure transcript-entry → text/message helpers, extracted from the canonical
 * agent-panel graph materializer. Leaf functions depending only on
 * TranscriptEntry — no canonical state, no side effects. GOD-safe.
 */
import type { TranscriptEntry } from "../../services/acp-types.js";

export function segmentText(entry: TranscriptEntry): string {
	let text = "";
	for (const segment of entry.segments) {
		if (text.length > 0 && entry.role !== "assistant") {
			text += "\n";
		}
		text += segment.text;
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
