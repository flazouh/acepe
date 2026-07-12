/**
 * Projects canonical user transcript segments into agent-panel user-row chunks.
 * Pure — no stores, no side effects.
 */
import type { TranscriptEntry, TranscriptSegment } from "../../services/acp-types.js";
import type { AgentUserContentChunk } from "@acepe/ui/agent-panel/types";
import { buildCommandChipModelFromSegment } from "./command-chip-model.js";

function localCommandPrimaryText(segment: Extract<TranscriptSegment, { kind: "localCommand" }>): string {
	if (segment.stdout.length > 0) {
		return segment.stdout;
	}
	if (segment.command.length > 0) {
		return segment.command;
	}
	return segment.message;
}

function segmentToUserChunk(segment: TranscriptSegment): AgentUserContentChunk | null {
	if (segment.kind === "text") {
		if (segment.text.length === 0) {
			return null;
		}
		return { kind: "text", text: segment.text };
	}

	if (segment.kind === "pastedContent") {
		if (segment.text.length === 0) {
			return null;
		}
		const encoded = btoa(unescape(encodeURIComponent(segment.text)));
		return { kind: "text", text: `@[text:${encoded}]` };
	}

	if (segment.kind === "localCommand") {
		if (
			segment.command.length === 0 &&
			segment.message.length === 0 &&
			segment.args.length === 0 &&
			segment.stdout.length === 0
		) {
			return null;
		}
		return {
			kind: "localCommand",
			command: segment.command,
			message: segment.message,
			args: segment.args,
			stdout: segment.stdout,
			chip: buildCommandChipModelFromSegment(segment),
		};
	}

	return null;
}

export function flattenUserChunkText(chunks: readonly AgentUserContentChunk[]): string {
	let text = "";
	for (const chunk of chunks) {
		if (text.length > 0) {
			text += "\n";
		}
		if (chunk.kind === "text") {
			text += chunk.text;
		} else {
			text += localCommandPrimaryText({
				kind: "localCommand",
				segmentId: "",
				command: chunk.command,
				message: chunk.message,
				args: chunk.args,
				stdout: chunk.stdout,
				modelDisplayName: chunk.chip.modelDisplayName ?? null,
				modelDescription: chunk.chip.modelDescription ?? null,
			});
		}
	}
	return text;
}

export function buildUserRowSceneModel(entry: TranscriptEntry): {
	chunks: readonly AgentUserContentChunk[];
	text: string;
} {
	const chunks: AgentUserContentChunk[] = [];
	for (const segment of entry.segments) {
		const chunk = segmentToUserChunk(segment);
		if (chunk !== null) {
			chunks.push(chunk);
		}
	}

	return {
		chunks,
		text: flattenUserChunkText(chunks),
	};
}

function isHeaderOnlyLocalCommand(chunk: Extract<AgentUserContentChunk, { kind: "localCommand" }>): boolean {
	return chunk.command.length > 0 && chunk.stdout.length === 0;
}

function isStdoutOnlyLocalCommand(chunk: Extract<AgentUserContentChunk, { kind: "localCommand" }>): boolean {
	return chunk.command.length === 0 && chunk.stdout.length > 0;
}

export function mergeAdjacentUserCommandChunks(
	left: readonly AgentUserContentChunk[],
	right: readonly AgentUserContentChunk[]
): readonly AgentUserContentChunk[] | null {
	if (left.length !== 1 || right.length !== 1) {
		return null;
	}

	const leftChunk = left[0];
	const rightChunk = right[0];
	if (leftChunk.kind !== "localCommand" || rightChunk.kind !== "localCommand") {
		return null;
	}

	if (!isHeaderOnlyLocalCommand(leftChunk) || !isStdoutOnlyLocalCommand(rightChunk)) {
		return null;
	}

	const mergedSegment: Extract<TranscriptSegment, { kind: "localCommand" }> = {
		kind: "localCommand",
		segmentId: "",
		command: leftChunk.command,
		message: leftChunk.message,
		args: leftChunk.args,
		stdout: rightChunk.stdout,
		modelDisplayName:
			rightChunk.chip.modelDisplayName ?? leftChunk.chip.modelDisplayName ?? null,
		modelDescription:
			rightChunk.chip.modelDescription ?? leftChunk.chip.modelDescription ?? null,
	};

	return [
		{
			kind: "localCommand",
			command: mergedSegment.command,
			message: mergedSegment.message,
			args: mergedSegment.args,
			stdout: mergedSegment.stdout,
			chip: buildCommandChipModelFromSegment(mergedSegment),
		},
	];
}
