import { describe, expect, it } from "bun:test";
import { ProjectId, type RpcProjectedProject, type RpcProjectedSession, SessionId } from "@acepe/contracts";
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
			[projectedSession({ title: "Stale projection title", updatedAt: "2026-08-20T12:00:00.000Z" })],
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
			[projectedSession({ title: "Renamed by another client", updatedAt: "2026-08-20T14:00:00.000Z" })],
			[fakeProject]
		);
		expect(merged[0]?.title).toBe("Renamed by another client");
	});

	it("skips archived projection rows", () => {
		const merged = mergeProjectionSessions(
			[],
			[projectedSession({ archivedAt: "2026-08-20T12:00:00.000Z" })],
			[fakeProject]
		);
		expect(merged).toHaveLength(0);
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
		const merged = mergeProjectionSessions([], [projectedSession({ provider: null })], [fakeProject]);
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
});
