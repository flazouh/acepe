/**
 * Pure function for normalizing chunk content.
 *
 * Deduplicates the thought-prefix detection/stripping logic that was
 * previously duplicated in createNewAssistantEntry, mergeChunkIntoEntry,
 * and MessageProcessor.processAgentChunk.
 */

import type { ContentBlock } from "../../services/converted-session-types.js";
import { hasThoughtPrefix, stripThoughtPrefix } from "../utils/thought-prefix-stripper.js";
import type { ChunkInput, NormalizedChunk } from "./chunk-aggregation-types.js";

/**
 * Normalize a chunk by detecting implicit thoughts and stripping
 * redundant thought prefixes.
 *
 * Handles two cases:
 * 1. Explicit thought (isThought=true) — strips redundant [Thinking] prefix
 * 2. Implicit thought (message with [Thinking] prefix) — detects, strips, converts to thought
 *
 * Pure function — no side effects.
 */
export function normalizeChunk(input: ChunkInput): NormalizedChunk {
	const { content, isThought } = input;

	// Detect implicit thought: a "message" chunk with [Thinking] prefix
	const hasImplicitThoughtPrefix =
		!isThought && content.type === "text" && hasThoughtPrefix(content.text);

	const actualIsThought = isThought || hasImplicitThoughtPrefix;

	// Strip redundant thought prefix for thoughts with text content
	let normalizedContent: ContentBlock = content;
	if (actualIsThought && content.type === "text") {
		const strippedText = stripThoughtPrefix(content.text);
		if (strippedText !== content.text) {
			normalizedContent = { type: "text", text: strippedText };
		}
	}

	return {
		type: actualIsThought ? "thought" : "message",
		block: normalizedContent,
	};
}
