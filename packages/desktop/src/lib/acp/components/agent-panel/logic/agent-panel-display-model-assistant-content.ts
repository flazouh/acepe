/**
 * Pure helpers for projecting assistant message content into displayed form.
 * Extracted verbatim from agent-panel-display-model.ts.
 */

import type {
	AssistantMessage,
	AssistantMessageChunk,
	ContentBlock,
} from "@acepe/ui/agent-panel";

export function cloneContentBlock(block: ContentBlock): ContentBlock {
	if (block.type === "text") {
		return { type: "text", text: block.text };
	}
	if (block.type === "image") {
		if (block.uri !== undefined) {
			return {
				type: "image",
				data: block.data,
				mimeType: block.mimeType,
				uri: block.uri,
			};
		}
		return {
			type: "image",
			data: block.data,
			mimeType: block.mimeType,
		};
	}
	if (block.type === "audio") {
		return {
			type: "audio",
			data: block.data,
			mimeType: block.mimeType,
		};
	}
	if (block.type === "resource") {
		return {
			type: "resource",
			resource: {
				uri: block.resource.uri,
				text: block.resource.text,
				blob: block.resource.blob,
				mimeType: block.resource.mimeType,
			},
		};
	}
	const result: ContentBlock = {
		type: "resource_link",
		uri: block.uri,
		name: block.name,
	};
	if (block.title !== undefined) {
		result.title = block.title;
	}
	if (block.description !== undefined) {
		result.description = block.description;
	}
	if (block.mimeType !== undefined) {
		result.mimeType = block.mimeType;
	}
	if (block.size !== undefined) {
		result.size = block.size;
	}
	return result;
}

export function createDisplayedAssistantTextChunk(
	chunk: AssistantMessageChunk,
	displayText: string,
	displayOffset: number,
	hasOriginalTextContent: boolean
): {
	readonly chunk: AssistantMessageChunk;
	readonly nextDisplayOffset: number;
} {
	if (chunk.type !== "message" || chunk.block.type !== "text") {
		return {
			chunk: {
				type: chunk.type,
				block: cloneContentBlock(chunk.block),
			},
			nextDisplayOffset: displayOffset,
		};
	}

	const originalTextLength = hasOriginalTextContent ? chunk.block.text.length : displayText.length;
	const nextDisplayOffset = Math.min(displayText.length, displayOffset + originalTextLength);
	return {
		chunk: {
			type: "message",
			block: {
				type: "text",
				text: displayText.slice(displayOffset, nextDisplayOffset),
			},
		},
		nextDisplayOffset,
	};
}

export function createDisplayedAssistantMessage(
	message: AssistantMessage,
	displayText: string
): AssistantMessage {
	const chunks: AssistantMessageChunk[] = [];
	let hasDisplayedTextChunk = false;
	let displayOffset = 0;
	let originalTextLength = 0;
	for (const chunk of message.chunks) {
		if (chunk.type === "message" && chunk.block.type === "text") {
			originalTextLength += chunk.block.text.length;
		}
	}
	const hasOriginalTextContent = originalTextLength > 0;
	for (const chunk of message.chunks) {
		const displayedChunk = createDisplayedAssistantTextChunk(
			chunk,
			displayText,
			displayOffset,
			hasOriginalTextContent
		);
		chunks.push(displayedChunk.chunk);
		if (chunk.type === "message" && chunk.block.type === "text") {
			hasDisplayedTextChunk = true;
			displayOffset = displayedChunk.nextDisplayOffset;
		}
	}

	if (!hasDisplayedTextChunk || displayOffset < displayText.length) {
		chunks.push({
			type: "message",
			block: {
				type: "text",
				text: displayText.slice(displayOffset),
			},
		});
	}

	return {
		chunks,
		model: message.model,
		displayModel: message.displayModel,
		receivedAt: message.receivedAt,
		thinkingDurationMs: message.thinkingDurationMs,
	};
}
