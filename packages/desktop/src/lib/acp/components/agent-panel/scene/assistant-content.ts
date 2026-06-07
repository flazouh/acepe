import type { ContentBlock } from "../../../../services/claude-history.js";
import type { SessionEntry } from "../../../application/dto/session-entry.js";

export function contentBlockToPlainText(block: ContentBlock): string {
	if (block.type === "text") {
		return block.text;
	}

	if (block.type === "resource_link") {
		return block.title ?? block.name ?? block.uri;
	}

	if (block.type === "resource") {
		return block.resource.text ?? block.resource.uri;
	}

	if (block.type === "image") {
		return block.uri ?? "[Image]";
	}

	if (block.type === "audio") {
		return "[Audio]";
	}

	return "";
}

export function contentBlocksToText(blocks: readonly ContentBlock[]): string {
	let text = "";

	for (const block of blocks) {
		text += contentBlockToPlainText(block);
	}

	return text.trim();
}

export function extractAssistantMarkdown(entry: Extract<SessionEntry, { type: "assistant" }>): string {
	let text = "";

	for (const chunk of entry.message.chunks) {
		if (chunk.type !== "message") {
			continue;
		}

		text += contentBlockToPlainText(chunk.block);
	}

	return text.trim();
}
