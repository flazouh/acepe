import { describe, expect, it } from "bun:test";
import {
	PROJECT_ICON_AUTO,
	ProjectId,
	type RpcProjectedProject,
	type RpcProjectedSession,
	SessionId
} from "@acepe/contracts";
import type { SessionCold } from "../../types.js";
import { isoToDate, mergeProjectionSessions } from "../session-projection-merge.js";

const projectId = ProjectId.make("project-1");
const otherProjectId = ProjectId.make("project-2");

const fakeProject: RpcProjectedProject = {
	projectId,
	title: "Acepe",
	workspaceRoot: "/tmp/acepe",
	createdAt: "2026-08-20T12:00:00.000Z",
	updatedAt: "2026-08-20T12:00:00.000Z",
	deletedAt: null,
	sessionCount: 1,
	color: "cyan",
	showExternalCliSessions: false,
	sortOrder: null,
	icon: PROJECT_ICON_AUTO,
	iconPath: null,
	gitStatus: [],
};

// A project with no on-disk provider history at all -- e.g. every session in
// it was dispatched via session.create and never had a real CLI adapter
// write a transcript file. Its sidebar section has no other route to
// populate its sessions than this union.
const diskFreeProject: RpcProjectedProject = {
	projectId: otherProjectId,
	title: "Git review",
	workspaceRoot: "/tmp/acepe-git-review",
	createdAt: "2026-08-20T12:00:00.000Z",
	updatedAt: "2026-08-20T12:00:00.000Z",
	deletedAt: null,
	sessionCount: 1,
	color: "cyan",
	showExternalCliSessions: false,
	sortOrder: null,
	icon: PROJECT_ICON_AUTO,
	iconPath: null,
	gitStatus: [],
};

function projectedSession(overrides: Partial<RpcProjectedSession> = {}): RpcProjectedSession {
	return {
		sessionId: SessionId.make("session-1"),
		projectId,
		title: "Fix the auth bug",
		provider: "claude-code",
		createdAt: "2026-08-20T12:00:00.000Z",
		updatedAt: "2026-08-20T12:00:00.000Z",
		lastActivityAt: "2026-08-20T12:00:00.000Z",
		archivedAt: null,
		deletedAt: null,
		prNumber: null,
		prLinkMode: null,
		providerSessionId: null,
		providerSessionFailed: false,
		...overrides,
	};
}

function cold(overrides: Partial<SessionCold> = {}): SessionCold {
	return {
		id: "session-1",
		projectPath: "/tmp/acepe",
		agentId: "claude-code",
		title: "Existing title",
		createdAt: isoToDate("2026-08-20T11:00:00.000Z"),
		updatedAt: isoToDate("2026-08-20T11:00:00.000Z"),
		parentId: null,
		...overrides,
	};
}

describe("mergeProjectionSessions", () => {
	it("adds a session dispatched via session.create with no matching disk-scanned entry", () => {
		const merged = mergeProjectionSessions([], [projectedSession()], [fakeProject]);
		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({
			id: "session-1",
			projectPath: "/tmp/acepe",
			agentId: "claude-code",
			title: "Fix the auth bug",
			sessionLifecycleState: "created",
		});
	});

	it("does not duplicate a session already present from the disk scan", () => {
		const existing = [cold()];
		const merged = mergeProjectionSessions(existing, [projectedSession()], [fakeProject]);
		expect(merged).toHaveLength(1);
	});

	it("keeps the existing title when the projection row is not newer", () => {
		const existing = [
			cold({ title: "Existing title", updatedAt: isoToDate("2026-08-20T13:00:00.000Z") }),
		];
		const merged = mergeProjectionSessions(
			existing,
			[
				projectedSession({
					title: "Stale projection title",
					updatedAt: "2026-08-20T12:00:00.000Z",
				}),
			],
			[fakeProject]
		);
		expect(merged[0]?.title).toBe("Existing title");
	});

	it("lets the projection row's title win only when it is strictly newer", () => {
		const existing = [
			cold({ title: "Old title", updatedAt: isoToDate("2026-08-20T11:00:00.000Z") }),
		];
		const merged = mergeProjectionSessions(
			existing,
			[
				projectedSession({
					title: "Renamed by another client",
					updatedAt: "2026-08-20T14:00:00.000Z",
				}),
			],
			[fakeProject]
		);
		expect(merged[0]?.title).toBe("Renamed by another client");
	});

	// Archived rows must stay in the union carrying the canonical fact: the
	// disk scan that runs right after would otherwise re-add the same session
	// with no archivedAt, and the sidebar would show it again on every
	// restart. The sidebar filters on archivedAt instead (selectActiveSessions).
	it("keeps an archived projection row and carries its archivedAt", () => {
		const merged = mergeProjectionSessions(
			[],
			[projectedSession({ archivedAt: "2026-08-20T12:00:00.000Z" })],
			[fakeProject]
		);
		expect(merged).toHaveLength(1);
		expect(merged[0]?.archivedAt).toEqual(isoToDate("2026-08-20T12:00:00.000Z"));
	});

	it("stamps archivedAt onto an existing disk-scanned session", () => {
		const merged = mergeProjectionSessions(
			[cold()],
			[projectedSession({ archivedAt: "2026-08-20T12:00:00.000Z" })],
			[fakeProject]
		);
		expect(merged).toHaveLength(1);
		expect(merged[0]?.archivedAt).toEqual(isoToDate("2026-08-20T12:00:00.000Z"));
	});

	it("clears archivedAt on an existing session the backend unarchived", () => {
		const merged = mergeProjectionSessions(
			[cold({ archivedAt: isoToDate("2026-08-20T12:00:00.000Z") })],
			[projectedSession()],
			[fakeProject]
		);
		expect(merged).toHaveLength(1);
		expect(merged[0]?.archivedAt).toBeNull();
	});

	it("stamps archivedAt onto a session matched by its provider session id", () => {
		const merged = mergeProjectionSessions(
			[cold({ id: "provider-uuid" })],
			[
				projectedSession({
					sessionId: SessionId.make("orchestration-id"),
					providerSessionId: "provider-uuid",
					archivedAt: "2026-08-20T12:00:00.000Z",
				}),
			],
			[fakeProject]
		);
		expect(merged).toHaveLength(1);
		expect(merged[0]?.archivedAt).toEqual(isoToDate("2026-08-20T12:00:00.000Z"));
	});

	it("skips deleted projection rows", () => {
		const merged = mergeProjectionSessions(
			[],
			[projectedSession({ deletedAt: "2026-08-20T12:00:00.000Z" })],
			[fakeProject]
		);
		expect(merged).toHaveLength(0);
	});

	it("skips a projection row with no resolved provider", () => {
		const merged = mergeProjectionSessions(
			[],
			[projectedSession({ provider: null })],
			[fakeProject]
		);
		expect(merged).toHaveLength(0);
	});

	it("skips a projection row whose project is not in the snapshot's project list", () => {
		const merged = mergeProjectionSessions(
			[],
			[projectedSession({ projectId: otherProjectId })],
			[fakeProject]
		);
		expect(merged).toHaveLength(0);
	});

	it("preserves unrelated existing sessions untouched", () => {
		const existing = [cold({ id: "session-other", title: "Unrelated session" })];
		const merged = mergeProjectionSessions(existing, [projectedSession()], [fakeProject]);
		expect(merged).toHaveLength(2);
		expect(merged.find((session) => session.id === "session-other")?.title).toBe(
			"Unrelated session"
		);
	});

	it("lists a project's session when that project has no on-disk history at all, alongside a project restored from disk", () => {
		// existingSessions mimics what a disk-only scan already restored for
		// project-1 (e.g. the real repo, which has real provider history on
		// disk). project-2 has no entry here because no provider ever wrote
		// history for it -- its only source of truth is the projection.
		const diskRestoredSession = cold({ id: "disk-session", title: "Restored from disk" });
		const gitReviewSession = projectedSession({
			sessionId: SessionId.make("git-review-session"),
			projectId: otherProjectId,
			title: "Review the notes diff",
		});

		const merged = mergeProjectionSessions(
			[diskRestoredSession],
			[gitReviewSession],
			[fakeProject, diskFreeProject]
		);

		expect(merged).toHaveLength(2);
		const listed = merged.find((session) => session.id === "git-review-session");
		expect(listed).toMatchObject({
			projectPath: "/tmp/acepe-git-review",
			title: "Review the notes diff",
			sessionLifecycleState: "created",
		});
	});

	it("skips a row with an unparseable timestamp instead of throwing, and still adds a good row for another project", () => {
		const malformedRow = projectedSession({
			sessionId: SessionId.make("malformed-session"),
			createdAt: "not-a-real-date",
		});
		const goodRow = projectedSession({
			sessionId: SessionId.make("git-review-session"),
			projectId: otherProjectId,
			title: "Review the notes diff",
		});

		let merged: SessionCold[] = [];
		expect(() => {
			merged = mergeProjectionSessions([], [malformedRow, goodRow], [fakeProject, diskFreeProject]);
		}).not.toThrow();

		expect(merged).toHaveLength(1);
		expect(merged[0]?.id).toBe("git-review-session");
	});

	it("skips an existing session's title/updatedAt refresh when the projection row's updatedAt is unparseable, without dropping the session", () => {
		const existing = [cold({ title: "Existing title" })];
		const merged = mergeProjectionSessions(
			existing,
			[projectedSession({ title: "Would-be new title", updatedAt: "not-a-real-date" })],
			[fakeProject]
		);

		expect(merged).toHaveLength(1);
		expect(merged[0]?.title).toBe("Existing title");
	});

	it("merges a projection row into its disk-scanned row when providerSessionId matches, instead of duplicating it (#262)", () => {
		const diskSession = cold({ id: "claude-uuid-42", title: "Existing on-disk title" });
		const projected = projectedSession({
			sessionId: SessionId.make("session-orchestration-1"),
			providerSessionId: "claude-uuid-42",
			title: "Renamed via orchestration",
			updatedAt: "2026-08-20T14:00:00.000Z",
		});

		const merged = mergeProjectionSessions([diskSession], [projected], [fakeProject]);

		expect(merged).toHaveLength(1);
		expect(merged[0]?.id).toBe("claude-uuid-42");
		expect(merged[0]?.title).toBe("Renamed via orchestration");
	});

	it("does not let a stale providerSessionId-aliased projection row overwrite a newer disk title", () => {
		const diskSession = cold({
			id: "claude-uuid-42",
			title: "Newer on-disk title",
			updatedAt: isoToDate("2026-08-20T15:00:00.000Z"),
		});
		const projected = projectedSession({
			sessionId: SessionId.make("session-orchestration-1"),
			providerSessionId: "claude-uuid-42",
			title: "Stale orchestration title",
			updatedAt: "2026-08-20T12:00:00.000Z",
		});

		const merged = mergeProjectionSessions([diskSession], [projected], [fakeProject]);

		expect(merged).toHaveLength(1);
		expect(merged[0]?.title).toBe("Newer on-disk title");
	});

	it("carries the PR link from a providerSessionId-aliased projection row onto the disk-scanned row", () => {
		const diskSession = cold({ id: "claude-uuid-42" });
		const projected = projectedSession({
			sessionId: SessionId.make("session-orchestration-1"),
			providerSessionId: "claude-uuid-42",
			prNumber: 42,
			prLinkMode: "manual",
		});

		const merged = mergeProjectionSessions([diskSession], [projected], [fakeProject]);

		expect(merged).toHaveLength(1);
		expect(merged[0]?.prNumber).toBe(42);
		expect(merged[0]?.prLinkMode).toBe("manual");
		expect(merged[0]?.linkedPr?.prNumber).toBe(42);
	});

	it("excludes a failed, diskless projection row instead of listing it as a ghost (#262)", () => {
		const projected = projectedSession({
			providerSessionFailed: true,
		});

		const merged = mergeProjectionSessions([], [projected], [fakeProject]);

		expect(merged).toHaveLength(0);
	});

	it("still lists a failed projection row when it already has disk backing (not a ghost)", () => {
		const diskSession = cold({ id: "claude-uuid-42" });
		const projected = projectedSession({
			sessionId: SessionId.make("session-orchestration-1"),
			providerSessionId: "claude-uuid-42",
			providerSessionFailed: true,
		});

		const merged = mergeProjectionSessions([diskSession], [projected], [fakeProject]);

		expect(merged).toHaveLength(1);
		expect(merged[0]?.id).toBe("claude-uuid-42");
	});
});
