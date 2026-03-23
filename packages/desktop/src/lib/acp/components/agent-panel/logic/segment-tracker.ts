import type { SessionEntry } from "../../../application/dto/session.js";

/**
 * Represents a conversation segment starting with a user message.
 * Each segment contains the user message and all subsequent entries
 * until the next user message.
 */
export interface ConversationSegment {
	/** Index of the user message in the entries array */
	userMessageIndex: number;
	/** The user message entry */
	userMessage: SessionEntry;
	/** Start index of the segment (inclusive, same as userMessageIndex) */
	startIndex: number;
	/** End index of the segment (exclusive) */
	endIndex: number;
}

/**
 * Builds an array of conversation segments from entries.
 * Each segment starts with a user message and includes all subsequent
 * entries until the next user message.
 *
 * @param entries - Array of session entries
 * @returns Array of conversation segments
 *
 * @example
 * ```ts
 * // Given entries: [User1, Assistant1, ToolCall1, User2, Assistant2]
 * // Returns:
 * // [
 * //   { userMessageIndex: 0, startIndex: 0, endIndex: 3 },
 * //   { userMessageIndex: 3, startIndex: 3, endIndex: 5 }
 * // ]
 * ```
 */
export function buildSegments(entries: readonly SessionEntry[]): ConversationSegment[] {
	const segments: ConversationSegment[] = [];
	let currentSegment: ConversationSegment | null = null;

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (entry.type === "user") {
			// Close previous segment
			if (currentSegment) {
				currentSegment.endIndex = i;
				segments.push(currentSegment);
			}
			// Start new segment
			currentSegment = {
				userMessageIndex: i,
				userMessage: entry,
				startIndex: i,
				endIndex: entries.length, // Will be updated when next segment starts
			};
		}
	}

	// Push final segment
	if (currentSegment) {
		segments.push(currentSegment);
	}

	return segments;
}

/**
 * Find which segment contains the given entry index.
 *
 * @param segments - Array of conversation segments
 * @param index - Entry index to find
 * @returns The segment containing the index, or null if not found
 */
export function findSegmentForIndex(
	segments: readonly ConversationSegment[],
	index: number
): ConversationSegment | null {
	for (const segment of segments) {
		if (index >= segment.startIndex && index < segment.endIndex) {
			return segment;
		}
	}
	return null;
}
