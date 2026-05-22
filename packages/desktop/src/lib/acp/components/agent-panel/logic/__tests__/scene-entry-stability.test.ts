import { describe, expect, it } from "vitest";

import { isSceneEntryStable, isStableSceneEntryAppend } from "../scene-entry-stability.js";

describe("scene-entry-stability", () => {
	it("treats fresh entries with the same canonical content as stable", () => {
		expect(
			isSceneEntryStable(
				{ id: "user-1", type: "user", text: "Prompt", timestampMs: 1 },
				{ id: "user-1", type: "user", text: "Prompt", timestampMs: 1 }
			)
		).toBe(true);
	});

	it("rejects changed canonical content", () => {
		expect(
			isSceneEntryStable(
				{ id: "assistant-1", type: "assistant", markdown: "First" },
				{ id: "assistant-1", type: "assistant", markdown: "Second" }
			)
		).toBe(false);
	});

	it("detects stable append-only scene updates", () => {
		expect(
			isStableSceneEntryAppend(
				[{ id: "user-1", type: "user", text: "Prompt" }],
				[
					{ id: "user-1", type: "user", text: "Prompt" },
					{ id: "assistant-1", type: "assistant", markdown: "Answer" },
				]
			)
		).toBe(true);
	});
});
