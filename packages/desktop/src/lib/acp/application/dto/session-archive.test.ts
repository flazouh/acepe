import { describe, expect, it } from "vitest";
import {
	isSessionArchived,
	selectActiveSessions,
	selectArchivedSessions,
} from "./session-archive.js";
import type { SessionCold } from "./session-cold.js";

function session(input: { id: string; archivedAt?: Date | null }): SessionCold {
	return {
		id: input.id,
		projectPath: "/projects/acepe",
		agentId: "claude",
		title: input.id,
		createdAt: new Date("2026-08-01T00:00:00.000Z"),
		updatedAt: new Date("2026-08-02T00:00:00.000Z"),
		parentId: null,
		archivedAt: input.archivedAt,
	};
}

describe("session archive selectors", () => {
	it("treats a session with no archivedAt as active", () => {
		expect(isSessionArchived(session({ id: "a" }))).toBe(false);
		expect(isSessionArchived(session({ id: "a", archivedAt: null }))).toBe(false);
	});

	it("treats a session with a canonical archivedAt as archived", () => {
		expect(
			isSessionArchived(session({ id: "a", archivedAt: new Date("2026-08-20T12:00:00.000Z") }))
		).toBe(true);
	});

	// The sidebar list must drop an archived session from the canonical fact
	// alone -- no client-side hide list is consulted any more.
	it("filters archived sessions out of the sidebar list", () => {
		const sessions = [
			session({ id: "active" }),
			session({ id: "archived", archivedAt: new Date("2026-08-20T12:00:00.000Z") }),
		];

		expect(selectActiveSessions(sessions).map((item) => item.id)).toEqual(["active"]);
		expect(selectArchivedSessions(sessions).map((item) => item.id)).toEqual(["archived"]);
	});
});
