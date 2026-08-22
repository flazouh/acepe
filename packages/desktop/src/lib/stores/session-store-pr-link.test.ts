import { describe, expect, it } from "bun:test";
import { CommandId, emptyRpcSessionSnapshot, ProjectId, SessionId } from "@acepe/contracts";

import { prLinkToggleCommand, shouldDispatchPrLinkToggle } from "./session-store-pr-link.ts";

const commandId = CommandId.make("cmd-pr");
const sessionId = SessionId.make("session-1");
const projectId = ProjectId.make("project-1");
const occurredAt = "2026-08-20T12:00:00.000Z";

describe("prLinkToggleCommand", () => {
	it("builds session.meta.update with the pull-request fields", () => {
		expect(
			prLinkToggleCommand({
				commandId,
				sessionId,
				prNumber: 42,
				prLinkMode: "manual",
			})
		).toEqual({
			type: "session.meta.update",
			commandId,
			sessionId,
			prNumber: 42,
			prLinkMode: "manual",
		});
	});

	it("builds an unlink command with a null prNumber", () => {
		expect(
			prLinkToggleCommand({
				commandId,
				sessionId,
				prNumber: null,
				prLinkMode: "automatic",
			})
		).toEqual({
			type: "session.meta.update",
			commandId,
			sessionId,
			prNumber: null,
			prLinkMode: "automatic",
		});
	});
});

describe("shouldDispatchPrLinkToggle", () => {
	const snapshot = emptyRpcSessionSnapshot(0);
	const linked = {
		snapshotSequence: 2,
		session: {
			sessionId,
			projectId,
			title: "First session",
			provider: null,
			createdAt: occurredAt,
			updatedAt: occurredAt,
			lastActivityAt: occurredAt,
			archivedAt: null,
			deletedAt: null,
			prNumber: 17,
			prLinkMode: "manual" as const,
		},
		messages: snapshot.messages,
		turns: snapshot.turns,
		activities: snapshot.activities,
		pendingApprovals: snapshot.pendingApprovals,
		projects: snapshot.projects,
		sessions: snapshot.sessions,
		settings: snapshot.settings,
		skillsCatalog: snapshot.skillsCatalog,
	};

	it("dispatches a manual override", () => {
		expect(shouldDispatchPrLinkToggle({ snapshot: linked, prLinkMode: "manual" })).toBe(true);
	});

	it("skips automatic updates while manual mode is active", () => {
		expect(shouldDispatchPrLinkToggle({ snapshot: linked, prLinkMode: "automatic" })).toBe(false);
	});
});
