import type { AssistantMessageChunk, ContentBlock } from "./types.js";

export type ChunkGroup = { type: "text"; text: string } | { type: "other"; block: ContentBlock };

export type GroupedAssistantChunks = {
	messageGroups: ChunkGroup[];
	thoughtGroups: ChunkGroup[];
};

type GroupAccumulator = {
	groups: ChunkGroup[];
	currentText: string | null;
};

const flushText = (accumulator: GroupAccumulator) => {
	if (accumulator.currentText === null) return;
	accumulator.groups.push({ type: "text", text: accumulator.currentText });
	accumulator.currentText = null;
};

export const groupAssistantChunks = (chunks: AssistantMessageChunk[]): GroupedAssistantChunks => {
	const message: GroupAccumulator = { groups: [], currentText: null };
	const thought: GroupAccumulator = { groups: [], currentText: null };

	for (const chunk of chunks) {
		const target = chunk.type === "thought" ? thought : message;
		const block = chunk.block;

		if (block.type === "text") {
			target.currentText =
				target.currentText === null ? block.text : target.currentText + block.text;
			continue;
		}

		flushText(target);
		target.groups.push({ type: "other", block });
	}

	flushText(message);
	flushText(thought);

	return {
		messageGroups: message.groups,
		thoughtGroups: thought.groups,
	};
};
