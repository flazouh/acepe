import { describe, expect, it } from "bun:test";
import { emptyRpcSessionSnapshot, ProjectId, SessionId } from "@acepe/contracts";

import {
	librarySidebarViewModel,
	sessionLifecycle,
	sessionLifecycleLabel,
} from "./library-state.ts";

const occurredAt = "2026-08-20T12:00:00.000Z";
const projectId = ProjectId.make("project-1");
const otherProjectId = ProjectId.make("project-2");

const session = (input: {
	readonly sessionId: string;
	readonly projectId: typeof projectId;
	readonly title: string;
	readonly archivedAt: string | null;
	readonly deletedAt: string | null;
}) => ({
	sessionId: SessionId.make(input.sessionId),
	projectId: input.projectId,
	title: input.title,
	provider: null,
	createdAt: occurredAt,
	updatedAt: occurredAt,
	lastActivityAt: occurredAt,
	archivedAt: input.archivedAt,
	deletedAt: input.deletedAt,
	prNumber: null,
	prLinkMode: null,
});

describe("sessionLifecycle", () => {
	it("prefers deleted over archived", () => {
		expect(
			sessionLifecycle(
				session({
					sessionId: "session-1",
					projectId,
					title: "Deleted thread",
					archivedAt: occurredAt,
					deletedAt: occurredAt,
				}),
			),
		).toBe("deleted");
		expect(
			sessionLifecycleLabel(
				sessionLifecycle(
					session({
						sessionId: "session-2",
						projectId,
						title: "Archived thread",
						archivedAt: occurredAt,
						deletedAt: null,
					}),
				),
			),
		).toBe("Archived");
	});
});

describe("librarySidebarViewModel", () => {
	it("maps projection titles without changing them and keeps archived and deleted sessions", () => {
		const snapshot = emptyRpcSessionSnapshot(4);
		const model = librarySidebarViewModel({
			snapshot: {
				snapshotSequence: snapshot.snapshotSequence,
				session: null,
				messages: snapshot.messages,
				turns: snapshot.turns,
				activities: snapshot.activities,
				pendingApprovals: snapshot.pendingApprovals,
				projects: [
					{
						projectId,
						title: "Acepe",
						workspaceRoot: "/tmp/acepe",
						createdAt: occurredAt,
						updatedAt: occurredAt,
						deletedAt: null,
						sessionCount: 3,
					},
				],
				sessions: [
					session({
						sessionId: "session-active",
						projectId,
						title: "Fix the auth bug",
						archivedAt: null,
						deletedAt: null,
					}),
					session({
						sessionId: "session-archived",
						projectId,
						title: "Archived thread",
						archivedAt: occurredAt,
						deletedAt: null,
					}),
					session({
						sessionId: "session-deleted",
						projectId,
						title: "Deleted thread",
						archivedAt: null,
						deletedAt: occurredAt,
					}),
					session({
						sessionId: "session-other",
						projectId: otherProjectId,
						title: "Other project session",
						archivedAt: null,
						deletedAt: null,
					}),
				],
			},
			selectedProjectId: projectId,
		});
		expect(model.projects[0]?.title).toBe("Acepe");
		expect(model.sessions.map((row) => row.title)).toEqual([
			"Fix the auth bug",
			"Archived thread",
			"Deleted thread",
		]);
		expect(model.sessions.map((row) => row.lifecycle)).toEqual([
			"active",
			"archived",
			"deleted",
		]);
	});
});
