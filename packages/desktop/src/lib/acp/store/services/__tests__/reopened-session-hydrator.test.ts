import { describe, expect, it } from "bun:test";
import type { RpcProjectedMessage, RpcSessionSnapshot } from "@acepe/contracts";
import { ApprovalRequestId, emptyRpcSessionSnapshot, ProjectId, SessionId } from "@acepe/contracts";
import * as Effect from "effect/Effect";

import type { SessionStateEnvelope } from "../../../../services/acp-types.js";
import { AgentError, type AppError } from "../../../errors/app-error.js";
import {
	hydrateReopenedSessionSnapshot,
	type ReopenedSessionHydratorDeps,
} from "../reopened-session-hydrator.js";

const SESSION_ID = SessionId.make("session-reopen-1");
const PROJECT_ID = ProjectId.make("project-1");

function baseInput() {
	return {
		sessionId: SESSION_ID,
		agentId: "claude-code",
		projectPath: "/repo",
		worktreePath: null,
		sourcePath: null as string | null,
		sequenceId: null,
	};
}

function withSession(snapshot: RpcSessionSnapshot, sessionId: SessionId): RpcSessionSnapshot {
	return {
		...snapshot,
		session: {
			sessionId,
			projectId: PROJECT_ID,
			title: "Reopened session",
			provider: "claude-code",
			createdAt: "2026-08-01T00:00:00.000Z",
			updatedAt: "2026-08-01T00:00:00.000Z",
			lastActivityAt: "2026-08-01T00:00:00.000Z",
			archivedAt: null,
			deletedAt: null,
			prNumber: null,
			prLinkMode: null,
			providerSessionId: null,
			providerSessionFailed: false,
		},
	};
}

function userMessage(messageId: string, text: string, sequence: number): RpcProjectedMessage {
	return {
		sessionId: SESSION_ID,
		sequence,
		messageId,
		turnId: null,
		rowType: "user",
		content: { text },
	};
}

describe("hydrateReopenedSessionSnapshot", () => {
	it("applies a canonical snapshot envelope when the session is already imported", async () => {
		const snapshot = withSession(
			{ ...emptyRpcSessionSnapshot(3), messages: [userMessage("msg-1", "hello", 1)] },
			SESSION_ID
		);
		const appliedEnvelopes: Array<{ sessionId: string; envelope: SessionStateEnvelope }> = [];
		let importCalls = 0;
		const deps: ReopenedSessionHydratorDeps = {
			getSessionSnapshot: () => Effect.succeed(snapshot),
			ensureProviderSessionImported: () => {
				importCalls += 1;
				return Effect.succeed({ resolvedSessionId: SESSION_ID });
			},
			applySessionStateEnvelope: (sessionId, envelope) => {
				appliedEnvelopes.push({ sessionId, envelope });
			},
			getCurrentGraphRevision: () => null,
		};

		const result = await Effect.runPromise(hydrateReopenedSessionSnapshot(baseInput(), deps));

		expect(result).toEqual({ applied: true, canonicalSessionId: SESSION_ID });
		expect(importCalls).toBe(0);
		expect(appliedEnvelopes).toHaveLength(1);
		expect(appliedEnvelopes[0]?.sessionId).toBe(SESSION_ID);
		const payload = appliedEnvelopes[0]?.envelope.payload;
		if (payload?.kind !== "snapshot") {
			throw new Error("expected a snapshot envelope");
		}
		expect(payload.graph.transcriptSnapshot.entries).toEqual([
			{
				entryId: "msg-1",
				role: "user",
				segments: [{ kind: "text", segmentId: "msg-1-text", text: "hello" }],
			},
		]);
	});

	it("imports an on-disk-only, never-imported session before hydrating", async () => {
		const preImportSnapshot = emptyRpcSessionSnapshot(0);
		const postImportSnapshot = withSession(
			{ ...emptyRpcSessionSnapshot(1), messages: [userMessage("msg-1", "hello", 1)] },
			SESSION_ID
		);
		let fetchCalls = 0;
		let importCalls = 0;
		const deps: ReopenedSessionHydratorDeps = {
			getSessionSnapshot: () => {
				fetchCalls += 1;
				return Effect.succeed(fetchCalls === 1 ? preImportSnapshot : postImportSnapshot);
			},
			ensureProviderSessionImported: () => {
				importCalls += 1;
				return Effect.succeed({ resolvedSessionId: SESSION_ID });
			},
			applySessionStateEnvelope: () => undefined,
			getCurrentGraphRevision: () => null,
		};

		const result = await Effect.runPromise(
			hydrateReopenedSessionSnapshot(
				{ ...baseInput(), sourcePath: "/home/user/.claude/x.jsonl" },
				deps
			)
		);

		expect(result).toEqual({ applied: true, canonicalSessionId: SESSION_ID });
		expect(importCalls).toBe(1);
		expect(fetchCalls).toBe(2);
	});

	it("does not attempt an import when the session has no on-disk sourcePath", async () => {
		let importCalls = 0;
		const deps: ReopenedSessionHydratorDeps = {
			getSessionSnapshot: () => Effect.succeed(emptyRpcSessionSnapshot(0)),
			ensureProviderSessionImported: () => {
				importCalls += 1;
				return Effect.succeed({ resolvedSessionId: SESSION_ID });
			},
			applySessionStateEnvelope: () => undefined,
			getCurrentGraphRevision: () => null,
		};

		const result = await Effect.runPromise(hydrateReopenedSessionSnapshot(baseInput(), deps));

		expect(result).toEqual({ applied: true, canonicalSessionId: SESSION_ID });
		expect(importCalls).toBe(0);
	});

	it("falls back to the pre-import snapshot when the import itself fails", async () => {
		const preImportSnapshot = emptyRpcSessionSnapshot(0);
		const appliedEnvelopes: SessionStateEnvelope[] = [];
		const deps: ReopenedSessionHydratorDeps = {
			getSessionSnapshot: () => Effect.succeed(preImportSnapshot),
			ensureProviderSessionImported: () =>
				Effect.fail(new AgentError("history.ensureProviderSessionImported", new Error("boom"))),
			applySessionStateEnvelope: (_sessionId, envelope) => {
				appliedEnvelopes.push(envelope);
			},
			getCurrentGraphRevision: () => null,
		};

		const result = await Effect.runPromise(
			hydrateReopenedSessionSnapshot(
				{ ...baseInput(), sourcePath: "/home/user/.claude/x.jsonl" },
				deps
			)
		);

		expect(result).toEqual({ applied: true, canonicalSessionId: SESSION_ID });
		expect(appliedEnvelopes).toHaveLength(1);
	});

	it("never fails outward when the snapshot fetch itself errors", async () => {
		const deps: ReopenedSessionHydratorDeps = {
			getSessionSnapshot: (): Effect.Effect<RpcSessionSnapshot, AppError> =>
				Effect.fail(new AgentError("acp.getSessionSnapshot", new Error("network down"))),
			ensureProviderSessionImported: () => Effect.succeed({ resolvedSessionId: SESSION_ID }),
			applySessionStateEnvelope: () => undefined,
			getCurrentGraphRevision: () => null,
		};

		const result = await Effect.runPromise(hydrateReopenedSessionSnapshot(baseInput(), deps));

		expect(result).toEqual({ applied: false, canonicalSessionId: SESSION_ID });
	});

	// AC-263 issue #263 defect 2: reopening a session whose local graph
	// already has transcript entries (e.g. from an earlier reopen, or from
	// live deltas) must still re-seed when the freshly-fetched snapshot is
	// genuinely newer -- not only on the first, from-empty hydration. See
	// reopen-snapshot-graph.ts's `reopenGraphRevisionForApply`, which this
	// hydrator now consults via the new `getCurrentGraphRevision` dependency.
	it("re-seeds when the local graph already has transcript entries but the snapshot is newer", async () => {
		const snapshot = withSession(
			{
				...emptyRpcSessionSnapshot(20),
				messages: [userMessage("msg-1", "hello", 1), userMessage("msg-2", "REHYDRATE_42", 18)],
			},
			SESSION_ID
		);
		const appliedEnvelopes: SessionStateEnvelope[] = [];
		const deps: ReopenedSessionHydratorDeps = {
			getSessionSnapshot: () => Effect.succeed(snapshot),
			ensureProviderSessionImported: () => Effect.succeed({ resolvedSessionId: SESSION_ID }),
			applySessionStateEnvelope: (_sessionId, envelope) => {
				appliedEnvelopes.push(envelope);
			},
			// A local graph already exists (this session was opened once
			// before) with a strictly older transcript revision.
			getCurrentGraphRevision: () => ({ graphRevision: 4, transcriptRevision: 3, lastEventSeq: 9 }),
		};

		const result = await Effect.runPromise(hydrateReopenedSessionSnapshot(baseInput(), deps));

		expect(result).toEqual({ applied: true, canonicalSessionId: SESSION_ID });
		expect(appliedEnvelopes).toHaveLength(1);
		const applied = appliedEnvelopes[0];
		if (applied?.payload.kind !== "snapshot") {
			throw new Error("expected a snapshot envelope");
		}
		expect(applied.payload.graph.transcriptSnapshot.entries.map((entry) => entry.entryId)).toEqual([
			"msg-1",
			"msg-2",
		]);
		// graphRevision must be strictly greater than the local graph's (4),
		// or it would lose the downstream isNewerGraphRevision comparison.
		expect(applied.graphRevision).toBeGreaterThan(4);
	});

	// Reload-loses-pending-approval root cause (live repro 2026-08-31): a
	// panel restored with the provider's on-disk uuid (the #262 alias display
	// identity) has no aggregate of its own -- the live session claimed that
	// uuid via provider_session_id. The import step now RESOLVES the uuid to
	// the claiming aggregate instead of forking a twin, and the hydrator must
	// follow that resolution: fetch the claiming aggregate's snapshot (which
	// carries the still-pending approval), apply the graph under the claiming
	// id, and report the canonical id so the caller can rebind the panel.
	it("follows the resolved aggregate when the requested id is a claimed provider uuid", async () => {
		const requestedUuid = "3c8bd13c-556e-428b-a155-ae33a1a0a0f6";
		const claimingSessionId = SessionId.make("session-session-create-claimed-1");
		const claimingSnapshot = withSession(
			{
				...emptyRpcSessionSnapshot(10),
				messages: [userMessage("msg-1", "run the command", 1)],
				pendingApprovals: [
					{
						approvalRequestId: ApprovalRequestId.make("perm-toolu-claimed-1"),
						sessionId: claimingSessionId,
						sequence: 9,
					},
				],
			},
			claimingSessionId
		);
		const fetchedIds: string[] = [];
		const appliedEnvelopes: Array<{ sessionId: string; envelope: SessionStateEnvelope }> = [];
		const deps: ReopenedSessionHydratorDeps = {
			getSessionSnapshot: (sessionId) => {
				fetchedIds.push(sessionId);
				return Effect.succeed(
					sessionId === claimingSessionId ? claimingSnapshot : emptyRpcSessionSnapshot(0)
				);
			},
			ensureProviderSessionImported: () =>
				Effect.succeed({ resolvedSessionId: claimingSessionId }),
			applySessionStateEnvelope: (sessionId, envelope) => {
				appliedEnvelopes.push({ sessionId, envelope });
			},
			getCurrentGraphRevision: () => null,
		};

		const result = await Effect.runPromise(
			hydrateReopenedSessionSnapshot(
				{
					...baseInput(),
					sessionId: requestedUuid,
					sourcePath: "/home/user/.claude/3c8bd13c.jsonl",
				},
				deps
			)
		);

		expect(result).toEqual({ applied: true, canonicalSessionId: claimingSessionId });
		expect(fetchedIds).toEqual([requestedUuid, claimingSessionId]);
		expect(appliedEnvelopes).toHaveLength(1);
		expect(appliedEnvelopes[0]?.sessionId).toBe(claimingSessionId);
		const payload = appliedEnvelopes[0]?.envelope.payload;
		if (payload?.kind !== "snapshot") {
			throw new Error("expected a snapshot envelope");
		}
		expect(payload.graph.canonicalSessionId).toBe(claimingSessionId);
		expect(payload.graph.requestedSessionId).toBe(requestedUuid);
		expect(payload.graph.isAlias).toBe(true);
		expect(payload.graph.interactions).toHaveLength(1);
		expect(payload.graph.interactions[0]?.id).toBe("perm-toolu-claimed-1");
	});

	// A soft-deleted session row (e.g. a twin the user deleted) still answers
	// the snapshot fetch with session !== null. When the requested id has an
	// on-disk source, the import/resolution step must still run so a claimed
	// provider uuid resolves to the live aggregate instead of hydrating the
	// deleted row's graph.
	it("resolves through the import step when the requested id's session row is deleted", async () => {
		const requestedUuid = "3c8bd13c-556e-428b-a155-ae33a1a0a0f6";
		const claimingSessionId = SessionId.make("session-session-create-claimed-1");
		const deletedTwinSnapshot: RpcSessionSnapshot = {
			...withSession(emptyRpcSessionSnapshot(5), SessionId.make(requestedUuid)),
		};
		if (deletedTwinSnapshot.session === null) {
			throw new Error("fixture must carry a session row");
		}
		const deletedSnapshot: RpcSessionSnapshot = {
			...deletedTwinSnapshot,
			session: { ...deletedTwinSnapshot.session, deletedAt: "2026-08-31T19:50:46.876Z" },
		};
		const claimingSnapshot = withSession(
			{
				...emptyRpcSessionSnapshot(10),
				pendingApprovals: [
					{
						approvalRequestId: ApprovalRequestId.make("perm-toolu-claimed-2"),
						sessionId: claimingSessionId,
						sequence: 9,
					},
				],
			},
			claimingSessionId
		);
		const appliedEnvelopes: Array<{ sessionId: string; envelope: SessionStateEnvelope }> = [];
		const deps: ReopenedSessionHydratorDeps = {
			getSessionSnapshot: (sessionId) =>
				Effect.succeed(sessionId === claimingSessionId ? claimingSnapshot : deletedSnapshot),
			ensureProviderSessionImported: () =>
				Effect.succeed({ resolvedSessionId: claimingSessionId }),
			applySessionStateEnvelope: (sessionId, envelope) => {
				appliedEnvelopes.push({ sessionId, envelope });
			},
			getCurrentGraphRevision: () => null,
		};

		const result = await Effect.runPromise(
			hydrateReopenedSessionSnapshot(
				{
					...baseInput(),
					sessionId: requestedUuid,
					sourcePath: "/home/user/.claude/3c8bd13c.jsonl",
				},
				deps
			)
		);

		expect(result).toEqual({ applied: true, canonicalSessionId: claimingSessionId });
		expect(appliedEnvelopes).toHaveLength(1);
		expect(appliedEnvelopes[0]?.sessionId).toBe(claimingSessionId);
		const payload = appliedEnvelopes[0]?.envelope.payload;
		if (payload?.kind !== "snapshot") {
			throw new Error("expected a snapshot envelope");
		}
		expect(payload.graph.interactions).toHaveLength(1);
	});

	it("does not re-apply when the local graph's transcript is already at least as new", async () => {
		const snapshot = withSession(
			{ ...emptyRpcSessionSnapshot(3), messages: [userMessage("msg-1", "hello", 1)] },
			SESSION_ID
		);
		const appliedEnvelopes: SessionStateEnvelope[] = [];
		const deps: ReopenedSessionHydratorDeps = {
			getSessionSnapshot: () => Effect.succeed(snapshot),
			ensureProviderSessionImported: () => Effect.succeed({ resolvedSessionId: SESSION_ID }),
			applySessionStateEnvelope: (_sessionId, envelope) => {
				appliedEnvelopes.push(envelope);
			},
			getCurrentGraphRevision: () => ({ graphRevision: 4, transcriptRevision: 9, lastEventSeq: 9 }),
		};

		const result = await Effect.runPromise(hydrateReopenedSessionSnapshot(baseInput(), deps));

		expect(result).toEqual({ applied: false, canonicalSessionId: SESSION_ID });
		expect(appliedEnvelopes).toHaveLength(0);
	});
});
