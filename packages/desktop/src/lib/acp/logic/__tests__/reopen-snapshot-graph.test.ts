import { describe, expect, it } from "bun:test";
import type { RpcProjectedMessage, RpcSessionSnapshot } from "@acepe/contracts";
import {
	ApprovalRequestId,
	emptyRpcSessionSnapshot,
	ProjectId,
	SessionId,
	TurnId,
} from "@acepe/contracts";

import { isNewerGraphRevision } from "../../store/envelope-reducer/graph-revision-order.js";
import { canonicalAgentIdFromString, graphFromReopenSnapshot } from "../reopen-snapshot-graph.js";

const SESSION_ID = SessionId.make("session-reopen-1");
const PROJECT_ID = ProjectId.make("project-1");
const TURN_ID = TurnId.make("turn-1");
const APPROVAL_REQUEST_ID = ApprovalRequestId.make("approval-1");

function withMessages(
	snapshotSequence: number,
	messages: ReadonlyArray<RpcProjectedMessage>
): RpcSessionSnapshot {
	return {
		...emptyRpcSessionSnapshot(snapshotSequence),
		session: {
			sessionId: SESSION_ID,
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
		messages,
	};
}

function baseInput(snapshot: RpcSessionSnapshot) {
	return {
		requestedSessionId: SESSION_ID,
		canonicalSessionId: SESSION_ID,
		agentId: "claude-code",
		projectPath: "/repo",
		worktreePath: null,
		sourcePath: "/home/user/.claude/projects/repo/session.jsonl",
		sequenceId: null,
		snapshot,
	};
}

describe("graphFromReopenSnapshot", () => {
	it("maps user/assistant/compaction rows into canonical transcript entries, in snapshot order", () => {
		const snapshot = withMessages(6, [
			{
				sessionId: SESSION_ID,
				sequence: 1,
				messageId: "msg-user-1",
				turnId: null,
				rowType: "user",
				content: { text: "Reply with exactly: REOPEN_42" },
			},
			{
				sessionId: SESSION_ID,
				sequence: 2,
				messageId: "msg-assistant-1",
				turnId: TURN_ID,
				rowType: "assistant",
				content: { text: "REOPEN_42" },
			},
			{
				sessionId: SESSION_ID,
				sequence: 3,
				messageId: "msg-compaction-1",
				turnId: null,
				rowType: "compaction",
				content: {
					status: "completed",
					trigger: "auto",
					preCompactionTokens: 1000,
					postCompactionTokens: 200,
					contextWindowSize: 200000,
					droppedTokens: 800,
					summary: "Compacted early turns",
				},
			},
		]);

		const graph = graphFromReopenSnapshot(baseInput(snapshot));

		expect(graph.transcriptSnapshot.entries).toEqual([
			{
				entryId: "msg-user-1",
				role: "user",
				segments: [
					{ kind: "text", segmentId: "msg-user-1-text", text: "Reply with exactly: REOPEN_42" },
				],
			},
			{
				entryId: "msg-assistant-1",
				role: "assistant",
				segments: [{ kind: "text", segmentId: "msg-assistant-1-text", text: "REOPEN_42" }],
			},
			{
				entryId: "msg-compaction-1",
				role: "sessionActivity",
				segments: [
					{
						kind: "compaction",
						segmentId: "msg-compaction-1-compaction",
						event: {
							eventId: "msg-compaction-1",
							sessionId: SESSION_ID,
							status: "completed",
							trigger: "auto",
							preCompactionTokens: 1000,
							postCompactionTokens: 200,
							droppedTokens: 800,
							contextWindowSize: 200000,
							summary: "Compacted early turns",
							providerMetadata: null,
						},
					},
				],
			},
		]);
		expect(graph.messageCount).toBe(3);
		expect(graph.lifecycle.status).toBe("ready");
		expect(graph.lifecycle.actionability.canSend).toBe(true);
		expect(graph.activity.kind).toBe("idle");
		expect(graph.turnState).toBe("Idle");
		expect(graph.operations).toEqual([]);
		expect(graph.interactions).toEqual([]);
	});

	it("reports waiting_for_user activity when the snapshot carries a pending approval", () => {
		const snapshot: RpcSessionSnapshot = {
			...withMessages(4, []),
			pendingApprovals: [
				{
					approvalRequestId: APPROVAL_REQUEST_ID,
					sessionId: SESSION_ID,
					sequence: 4,
					title: "Run rm -rf",
				},
			],
		};

		const graph = graphFromReopenSnapshot(baseInput(snapshot));

		expect(graph.activity.kind).toBe("waiting_for_user");
	});

	it("marks an unknown/never-imported session as reserved (not ready)", () => {
		const snapshot = emptyRpcSessionSnapshot(0);

		const graph = graphFromReopenSnapshot(baseInput(snapshot));

		expect(graph.lifecycle.status).toBe("reserved");
		expect(graph.lifecycle.actionability.canSend).toBe(false);
	});

	it("marks a session with no known/built-in agent id as a custom canonical agent id", () => {
		const snapshot = withMessages(1, []);

		const graph = graphFromReopenSnapshot({ ...baseInput(snapshot), agentId: "some-other-cli" });

		expect(graph.agentId).toEqual({ custom: "some-other-cli" });
	});

	it("maps a built-in agent id straight through", () => {
		expect(canonicalAgentIdFromString("claude-code")).toBe("claude-code");
	});

	// GOD: this is the invariant session-open-snapshot-applier.svelte.ts already
	// documents for the Tauri-era SessionOpenFound path ("rows apply, then get
	// wiped seconds later" bug) -- a hydration built from a snapshot fetched
	// *before* live deltas landed must never look newer, once compared through
	// the exact `isNewerGraphRevision` guard reduce-command.ts's `replaceGraph`
	// command already applies, than a graph a live session has since advanced.
	it("produces a revision that isNewerGraphRevision correctly orders against a later live graph revision", () => {
		const staleSnapshot = withMessages(2, []);
		const staleGraph = graphFromReopenSnapshot(baseInput(staleSnapshot));

		const liveGraphRevision = {
			graphRevision: 1,
			transcriptRevision: 5,
			lastEventSeq: 5,
		};

		expect(isNewerGraphRevision(liveGraphRevision, staleGraph.revision)).toBe(false);
	});

	it("produces a revision newer than an empty (no previous graph) session", () => {
		const snapshot = withMessages(3, []);
		const graph = graphFromReopenSnapshot(baseInput(snapshot));

		expect(isNewerGraphRevision(null, graph.revision)).toBe(true);
	});
});
