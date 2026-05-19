import { describe, expect, it } from "vitest";

import type { TranscriptEntry } from "$lib/services/acp-types.js";
import type { Checkpoint } from "../../types/checkpoint.js";
import {
	deriveCheckpointUserMessagePreviews,
	extractCheckpointTextPreview,
} from "./checkpoint-message-preview.js";

function checkpoint(input: {
	readonly id: string;
	readonly createdAt: number;
}): Checkpoint {
	return {
		id: input.id,
		sessionId: "session-1",
		checkpointNumber: 1,
		name: null,
		createdAt: input.createdAt,
		toolCallId: null,
		isAuto: true,
		fileCount: 1,
		totalLinesAdded: 1,
		totalLinesRemoved: 0,
	};
}

function transcriptEntry(input: {
	readonly entryId: string;
	readonly role: "user" | "assistant";
	readonly text: string;
	readonly timestampMs: number;
}): TranscriptEntry {
	return {
		entryId: input.entryId,
		role: input.role,
		segments: [
			{
				kind: "text",
				segmentId: `${input.entryId}-segment`,
				text: input.text,
			},
		],
		timestampMs: input.timestampMs,
	};
}

describe("deriveCheckpointUserMessagePreviews", () => {
	it("returns null when canonical transcript entries are unavailable", () => {
		const previews = deriveCheckpointUserMessagePreviews({
			transcriptEntries: null,
			checkpoints: [
				checkpoint({
					id: "checkpoint-1",
					createdAt: 200,
				}),
			],
		});

		expect(previews).toBeNull();
	});

	it("uses the last user message before each checkpoint", () => {
		const previews = deriveCheckpointUserMessagePreviews({
			transcriptEntries: [
				transcriptEntry({
					entryId: "user-1",
					role: "user",
					text: "first request",
					timestampMs: 100,
				}),
				transcriptEntry({
					entryId: "assistant-1",
					role: "assistant",
					text: "assistant response",
					timestampMs: 150,
				}),
				transcriptEntry({
					entryId: "user-2",
					role: "user",
					text: "second request",
					timestampMs: 300,
				}),
			],
			checkpoints: [
				checkpoint({
					id: "checkpoint-1",
					createdAt: 200,
				}),
				checkpoint({
					id: "checkpoint-2",
					createdAt: 400,
				}),
			],
		});

		expect(previews?.get("checkpoint-1")).toBe("first request");
		expect(previews?.get("checkpoint-2")).toBe("second request");
	});
});

describe("extractCheckpointTextPreview", () => {
	it("truncates long text with an ASCII suffix", () => {
		const preview = extractCheckpointTextPreview(
			transcriptEntry({
				entryId: "user-long",
				role: "user",
				text: "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz",
				timestampMs: 100,
			})
		);

		expect(preview).toBe("abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwx...");
	});
});
