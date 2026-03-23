import { describe, expect, it } from "bun:test";

import type { SessionEntry } from "../application/dto/session-entry.js";

import { estimateSessionEntryHeight, SESSION_LIST_OVERSCAN } from "./virtualization-tuning";

function createUserEntry(text: string): SessionEntry {
	return {
		id: "user-1",
		type: "user",
		message: {
			content: { type: "text", text },
			chunks: [{ type: "text", text }],
		},
	};
}

describe("virtualization tuning", () => {
	it("uses stronger overscan defaults for session list", () => {
		expect(SESSION_LIST_OVERSCAN).toBe(18);
	});

	it("estimates taller rows for long user text in session list", () => {
		const short = estimateSessionEntryHeight(createUserEntry("short"));
		const long = estimateSessionEntryHeight(createUserEntry("a".repeat(1200)));
		expect(long).toBeGreaterThan(short);
	});
});
