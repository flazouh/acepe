import { describe, expect, it } from "bun:test";

import type { SessionEntry } from "../../../../application/dto/session.js";
import { resolveVisibleSessionEntries } from "../visible-session-entries.js";

function createUserEntry(id: string): SessionEntry {
	return {
		id,
		type: "user",
		message: {
			content: { type: "text", text: "hello" },
			chunks: [{ type: "text", text: "hello" }],
		},
	};
}

function createErrorEntry(id: string, content: string): SessionEntry {
	return {
		id,
		type: "error",
		message: {
			content,
			kind: "recoverable",
		},
	};
}

function getErrorMessage(entry: SessionEntry) {
	if (entry.type !== "error") {
		throw new Error("Expected error entry");
	}

	return entry.message;
}

describe("resolveVisibleSessionEntries", () => {
	it("removes the trailing active turn error when the inline error card is shown", () => {
		const userEntry = createUserEntry("user-1");
		const errorEntry = createErrorEntry("error-1", "Rate limit reached");
		const result = resolveVisibleSessionEntries({
			sessionEntries: [userEntry, errorEntry],
			showInlineErrorCard: true,
			activeTurnError: getErrorMessage(errorEntry),
		});

		expect(result).toEqual([userEntry]);
	});

	it("keeps the error entry when the inline card is not shown", () => {
		const errorEntry = createErrorEntry("error-1", "Rate limit reached");
		const result = resolveVisibleSessionEntries({
			sessionEntries: [errorEntry],
			showInlineErrorCard: false,
			activeTurnError: getErrorMessage(errorEntry),
		});

		expect(result).toEqual([errorEntry]);
	});

	it("keeps historical error entries that are not the active turn error", () => {
		const historicalError = createErrorEntry("error-1", "Earlier error");
		const activeTurnError = createErrorEntry("error-2", "Latest error");
		const result = resolveVisibleSessionEntries({
			sessionEntries: [createUserEntry("user-1"), historicalError],
			showInlineErrorCard: true,
			activeTurnError: getErrorMessage(activeTurnError),
		});

		expect(result).toEqual([createUserEntry("user-1"), historicalError]);
	});

	it("removes all trailing duplicate error entries for the active failed turn", () => {
		const userEntry = createUserEntry("user-1");
		const transportError: SessionEntry = {
			id: "error-1",
			type: "error",
			message: {
				content: "Usage limit reached",
				kind: "fatal",
				source: "transport",
			},
		};
		const processError: SessionEntry = {
			id: "error-2",
			type: "error",
			message: {
				content: "Usage limit reached",
				kind: "fatal",
				source: "process",
			},
		};

		const result = resolveVisibleSessionEntries({
			sessionEntries: [userEntry, transportError, processError],
			showInlineErrorCard: true,
			activeTurnError: processError.message,
		});

		expect(result).toEqual([userEntry]);
	});
});
