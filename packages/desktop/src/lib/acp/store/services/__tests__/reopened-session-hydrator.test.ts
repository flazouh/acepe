import { describe, expect, it } from "bun:test";
import type { RpcProjectedMessage, RpcSessionSnapshot } from "@acepe/contracts";
import { emptyRpcSessionSnapshot, ProjectId, SessionId } from "@acepe/contracts";
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
				return Effect.void;
			},
			applySessionStateEnvelope: (sessionId, envelope) => {
				appliedEnvelopes.push({ sessionId, envelope });
			},
			getCurrentGraphRevision: () => null,
		};

		const result = await Effect.runPromise(hydrateReopenedSessionSnapshot(baseInput(), deps));

		expect(result).toEqual({ applied: true });
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
				return Effect.void;
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

		expect(result).toEqual({ applied: true });
		expect(importCalls).toBe(1);
		expect(fetchCalls).toBe(2);
	});

	it("does not attempt an import when the session has no on-disk sourcePath", async () => {
		let importCalls = 0;
		const deps: ReopenedSessionHydratorDeps = {
			getSessionSnapshot: () => Effect.succeed(emptyRpcSessionSnapshot(0)),
			ensureProviderSessionImported: () => {
				importCalls += 1;
				return Effect.void;
			},
			applySessionStateEnvelope: () => undefined,
			getCurrentGraphRevision: () => null,
		};

		const result = await Effect.runPromise(hydrateReopenedSessionSnapshot(baseInput(), deps));

		expect(result).toEqual({ applied: true });
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

		expect(result).toEqual({ applied: true });
		expect(appliedEnvelopes).toHaveLength(1);
	});

	it("never fails outward when the snapshot fetch itself errors", async () => {
		const deps: ReopenedSessionHydratorDeps = {
			getSessionSnapshot: (): Effect.Effect<RpcSessionSnapshot, AppError> =>
				Effect.fail(new AgentError("acp.getSessionSnapshot", new Error("network down"))),
			ensureProviderSessionImported: () => Effect.void,
			applySessionStateEnvelope: () => undefined,
			getCurrentGraphRevision: () => null,
		};

		const result = await Effect.runPromise(hydrateReopenedSessionSnapshot(baseInput(), deps));

		expect(result).toEqual({ applied: false });
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
			ensureProviderSessionImported: () => Effect.void,
			applySessionStateEnvelope: (_sessionId, envelope) => {
				appliedEnvelopes.push(envelope);
			},
			// A local graph already exists (this session was opened once
			// before) with a strictly older transcript revision.
			getCurrentGraphRevision: () => ({ graphRevision: 4, transcriptRevision: 3, lastEventSeq: 9 }),
		};

		const result = await Effect.runPromise(hydrateReopenedSessionSnapshot(baseInput(), deps));

		expect(result).toEqual({ applied: true });
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

	it("does not re-apply when the local graph's transcript is already at least as new", async () => {
		const snapshot = withSession(
			{ ...emptyRpcSessionSnapshot(3), messages: [userMessage("msg-1", "hello", 1)] },
			SESSION_ID
		);
		const appliedEnvelopes: SessionStateEnvelope[] = [];
		const deps: ReopenedSessionHydratorDeps = {
			getSessionSnapshot: () => Effect.succeed(snapshot),
			ensureProviderSessionImported: () => Effect.void,
			applySessionStateEnvelope: (_sessionId, envelope) => {
				appliedEnvelopes.push(envelope);
			},
			getCurrentGraphRevision: () => ({ graphRevision: 4, transcriptRevision: 9, lastEventSeq: 9 }),
		};

		const result = await Effect.runPromise(hydrateReopenedSessionSnapshot(baseInput(), deps));

		expect(result).toEqual({ applied: false });
		expect(appliedEnvelopes).toHaveLength(0);
	});
});
