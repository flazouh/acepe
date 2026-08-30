/**
 * `getSessionCold` must report the row the list actually holds.
 *
 * It does not return the stored row. It rebuilds one out of `getSessionIdentity`
 * plus `getSessionMetadata`, each of which copies its fields by hand, so a field
 * left out of that copy is reported as absent even though the list holds it.
 * That is not theoretical: `archivedAt` was missing, so every archived session
 * read back as active and unarchiving through that path did nothing (fixed in
 * 63f4dffea).
 *
 * These tests pin the invariant rather than a field list. `getAllSessions`
 * copies the stored row whole, so comparing the two catches the next field
 * somebody forgets to add to the slice, not only the ones forgotten so far.
 */

import { describe, expect, it } from "vitest";

import { buildPartialSessionLinkedPr } from "../../application/dto/session-linked-pr.js";
import { SessionListState } from "../session-list-state.svelte.js";
import type { SessionCold } from "../types.js";

const sessionId = "session-cold-slice";

/** Every optional field populated: a field dropped from the slice reads as undefined and fails. */
function fullyPopulatedSession(): SessionCold {
	return {
		id: sessionId,
		projectPath: "/project",
		agentId: "claude-code",
		worktreePath: "/worktrees/project-a",
		title: "Fully populated",
		createdAt: new Date("2026-08-30T09:00:00.000Z"),
		updatedAt: new Date("2026-08-30T10:00:00.000Z"),
		sourcePath: "/history/session.jsonl",
		sessionLifecycleState: "persisted",
		parentId: null,
		archivedAt: new Date("2026-08-30T12:00:00.000Z"),
		prNumber: 412,
		prState: "OPEN",
		prLinkMode: "manual",
		linkedPr: buildPartialSessionLinkedPr(412, "OPEN"),
		worktreeDeleted: false,
		sequenceId: 7,
		usageStats: {
			totalMessages: 12,
			userMessages: 5,
			assistantMessages: 7,
			totalInputTokens: 4200,
			totalOutputTokens: 1300,
		},
	};
}

function storedRow(listState: SessionListState): SessionCold | undefined {
	return listState.getAllSessions().find((session) => session.id === sessionId);
}

describe("SessionListState.getSessionCold", () => {
	it("reports every field addSession wrote", () => {
		const listState = new SessionListState();
		listState.addSession(fullyPopulatedSession());

		expect(listState.getSessionCold(sessionId)).toEqual(storedRow(listState));
	});

	it("reports every field updateSession wrote", () => {
		const listState = new SessionListState();
		listState.addSession(fullyPopulatedSession());

		listState.updateSession(
			sessionId,
			{
				title: "Renamed",
				archivedAt: null,
				usageStats: {
					totalMessages: 30,
					userMessages: 14,
					assistantMessages: 16,
					totalInputTokens: 9100,
					totalOutputTokens: 3300,
				},
			},
			{ touchUpdatedAt: false }
		);

		expect(listState.getSessionCold(sessionId)).toEqual(storedRow(listState));
	});

	it("keeps usage totals a write put on the row", () => {
		const listState = new SessionListState();
		listState.addSession(fullyPopulatedSession());

		expect(listState.getSessionCold(sessionId)?.usageStats?.totalInputTokens).toBe(4200);
	});
});
