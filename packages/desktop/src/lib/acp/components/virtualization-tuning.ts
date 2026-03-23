import type { ContentBlock } from "../../services/converted-session-types.js";
import type { SessionEntry } from "../application/dto/session-entry.js";

export const SESSION_LIST_OVERSCAN = 18;

const MIN_ROW_HEIGHT = 60;

function estimateTextBlockExtraHeight(block: ContentBlock | undefined): number {
	if (!block) return 0;
	if (block.type !== "text") return 32;
	const estimatedLines = Math.ceil(block.text.length / 140);
	const boundedLines = Math.min(10, Math.max(0, estimatedLines - 1));
	return boundedLines * 18;
}

function estimateSessionEntryExtraHeight(entry: SessionEntry): number {
	if (entry.type === "user") {
		return estimateTextBlockExtraHeight(entry.message.content);
	}

	if (entry.type === "assistant") {
		const total = entry.message.chunks.reduce((sum, chunk) => {
			return sum + estimateTextBlockExtraHeight(chunk.block);
		}, 0);
		return Math.min(220, total);
	}

	if (entry.type === "tool_call") {
		const locationCount = entry.message.locations?.length ?? 0;
		return Math.min(180, locationCount * 16);
	}

	if (entry.type === "ask") {
		return Math.min(120, entry.message.options.length * 20);
	}

	if (entry.type === "error") {
		const estimatedLines = Math.ceil(entry.message.content.length / 120);
		return Math.min(120, Math.max(0, estimatedLines - 1) * 18);
	}

	return 0;
}

export function estimateSessionEntryHeight(entry: SessionEntry): number {
	const baseHeightByType: Record<SessionEntry["type"], number> = {
		user: 82,
		assistant: 108,
		tool_call: 124,
		ask: 96,
		error: 92,
	};

	return Math.max(
		MIN_ROW_HEIGHT,
		baseHeightByType[entry.type] + estimateSessionEntryExtraHeight(entry)
	);
}
