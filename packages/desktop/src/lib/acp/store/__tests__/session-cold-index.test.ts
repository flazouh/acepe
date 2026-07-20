import { describe, expect, it } from "vitest";

import { sessionColdFromSlices } from "../../application/dto/session-cold.js";
import {
	createPatchedReferenceArray,
	createPatchedSessionColdArray,
	createPrependedReferenceArray,
	createPrependedSessionColdArray,
	type SessionLiveSyncReference,
} from "../session-cold-index.js";
import type { SessionCold } from "../types.js";

function createReference(id: string, updatedAtMs: number): SessionLiveSyncReference {
	return {
		id,
		updatedAtMs,
	};
}

function createSession(id: string, title: string): SessionCold {
	const now = new Date("2026-07-02T00:00:00.000Z");
	return sessionColdFromSlices(
		{
			id,
			projectPath: "/repo",
			agentId: "cursor",
			worktreePath: undefined,
		},
		{
			title,
			createdAt: now,
			updatedAt: now,
			sourcePath: undefined,
			sessionLifecycleState: "created",
			parentId: null,
			prNumber: undefined,
			prState: undefined,
			prLinkMode: undefined,
			linkedPr: undefined,
			worktreeDeleted: false,
			sequenceId: null,
			usageStats: undefined,
		}
	);
}

describe("session cold index array helpers", () => {
	it("returns enumerable arrays when prepending and patching sessions", () => {
		const first = createSession("session-1", "First");
		const second = createSession("session-2", "Second");
		const renamedFirst = createSession("session-1", "Renamed first");

		const prepended = createPrependedSessionColdArray(second, [first]);
		expect(Object.keys(prepended)).toEqual(["0", "1"]);
		expect(Object.entries(prepended).map(([key, session]) => `${key}:${session.id}`)).toEqual([
			"0:session-2",
			"1:session-1",
		]);

		const patched = createPatchedSessionColdArray(prepended, 1, renamedFirst);
		expect(Object.keys(patched)).toEqual(["0", "1"]);
		expect(patched.map((session) => `${session.id}:${session.title}`)).toEqual([
			"session-2:Second",
			"session-1:Renamed first",
		]);
	});

	it("returns enumerable arrays after repeated reference updates", () => {
		let references: SessionLiveSyncReference[] = [];
		for (let index = 0; index < 50; index += 1) {
			references = createPrependedReferenceArray(
				createReference(`session-${index}`, index),
				references
			);
		}

		const patched = createPatchedReferenceArray(references, createReference("session-25", 100));

		expect(Object.keys(patched)).toHaveLength(50);
		expect(patched[0]?.id).toBe("session-49");
		expect(patched[24]?.id).toBe("session-25");
		expect(patched[24]?.updatedAtMs).toBe(100);
		expect(patched[49]?.id).toBe("session-0");
	});
});
