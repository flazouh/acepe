import type { TranscriptEntry } from "$lib/services/acp-types.js";
import type { Checkpoint } from "../../types/checkpoint.js";

const MAX_PREVIEW_LENGTH = 50;

/**
 * Extract text preview from a user entry's content.
 * Returns null if content is not text or is empty.
 */
export function extractCheckpointTextPreview(entry: TranscriptEntry): string | null {
	let content = "";
	for (const segment of entry.segments) {
		content += segment.text;
	}

	const text = content.trim();
	if (text.length === 0) return null;

	return text.length > MAX_PREVIEW_LENGTH ? `${text.substring(0, MAX_PREVIEW_LENGTH)}...` : text;
}

export function deriveCheckpointUserMessagePreviews(input: {
	readonly transcriptEntries: readonly TranscriptEntry[] | null;
	readonly checkpoints: readonly Checkpoint[];
}): Map<string, string | null> | null {
	if (input.transcriptEntries === null) {
		return null;
	}

	const previews = new Map<string, string | null>();

	if (input.checkpoints.length === 0) return previews;

	const userEntries = input.transcriptEntries.filter((entry) => entry.role === "user");

	for (const checkpoint of input.checkpoints) {
		const checkpointTime = checkpoint.createdAt;
		const lastUserEntry = userEntries.findLast(
			(entry) => (entry.timestampMs ?? 0) <= checkpointTime
		);

		previews.set(checkpoint.id, lastUserEntry ? extractCheckpointTextPreview(lastUserEntry) : null);
	}

	return previews;
}
