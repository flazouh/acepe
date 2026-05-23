import { describe, expect, it } from "vitest";

import type { SessionEntry } from "../../../../application/dto/session-entry.js";
import { resolveVisibleSessionEntries } from "../visible-session-entries.js";

function createErrorEntry(
	message: Extract<SessionEntry, { type: "error" }>["message"]
): SessionEntry {
	return {
		id: "error-1",
		type: "error",
		message,
		timestamp: new Date("2026-04-15T00:00:00.000Z"),
	};
}

describe("resolveVisibleSessionEntries", () => {
	it("hides a trailing persisted error row when canonical failed-turn state matches it", () => {
		const sessionEntries: SessionEntry[] = [
			createErrorEntry({
				content: "Usage limit reached",
				code: "429",
				kind: "recoverable",
				source: "process",
			}),
		];

		const result = resolveVisibleSessionEntries({
			sessionEntries,
			activeTurnError: {
				content: "Usage limit reached",
				code: "429",
				kind: "recoverable",
				source: "process",
			},
		});

		expect(result).toEqual([]);
	});

	it("hides a trailing persisted error row without copying the transcript entries", () => {
		const sessionEntries: SessionEntry[] = [
			{
				id: "user-1",
				type: "user",
				message: {
					content: { type: "text", text: "hello" },
					chunks: [{ type: "text", text: "hello" }],
				},
				timestamp: new Date("2026-04-15T00:00:00.000Z"),
			},
			createErrorEntry({
				content: "Usage limit reached",
				code: "429",
				kind: "recoverable",
				source: "process",
			}),
		];
		const originalSlice = sessionEntries.slice;
		sessionEntries.slice = () => {
			throw new Error("must not copy session entries to hide a duplicate error tail");
		};

		try {
			const result = resolveVisibleSessionEntries({
				sessionEntries,
				activeTurnError: {
					content: "Usage limit reached",
					code: "429",
					kind: "recoverable",
					source: "process",
				},
			});

			expect(result).toEqual([sessionEntries[0]]);
			expect(result).toHaveLength(1);
			expect(result[0]).toBe(sessionEntries[0]);
		} finally {
			sessionEntries.slice = originalSlice;
		}
	});

	it("hides a trailing transcript error row when canonical failed-turn metadata is richer", () => {
		const sessionEntries: SessionEntry[] = [
			createErrorEntry({
				content:
					'Failed to authenticate. API Error: 401 {"error":{"message":"User not found.","code":401}}',
			}),
		];

		const result = resolveVisibleSessionEntries({
			sessionEntries,
			activeTurnError: {
				content:
					'Failed to authenticate. API Error: 401 {"error":{"message":"User not found.","code":401}}',
				code: "401",
				kind: "fatal",
				source: "transport",
			},
		});

		expect(result).toEqual([]);
	});

	it("keeps transcript entries when the canonical failed-turn state does not match", () => {
		const sessionEntries: SessionEntry[] = [
			createErrorEntry({
				content: "Usage limit reached",
				code: "429",
				kind: "recoverable",
				source: "transport",
			}),
		];

		const result = resolveVisibleSessionEntries({
			sessionEntries,
			activeTurnError: {
				content: "Usage limit reached",
				code: "429",
				kind: "recoverable",
				source: "process",
			},
		});

		expect(result).toEqual(sessionEntries);
	});

	it("treats missing persisted error source as unknown for legacy duplicate suppression", () => {
		const sessionEntries: SessionEntry[] = [
			createErrorEntry({
				content: "Usage limit reached",
				code: "429",
				kind: "recoverable",
			}),
		];

		const result = resolveVisibleSessionEntries({
			sessionEntries,
			activeTurnError: {
				content: "Usage limit reached",
				code: "429",
				kind: "recoverable",
				source: "unknown",
			},
		});

		expect(result).toEqual([]);
	});
});
