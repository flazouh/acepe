import { describe, expect, it } from "vitest";

import type { SessionEntry } from "../../../../application/dto/session.js";
import { resolveVisibleSessionEntries } from "../visible-session-entries.js";

function createErrorEntry(message: Extract<SessionEntry, { type: "error" }>["message"]): SessionEntry {
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
