import { describe, expect, it } from "bun:test";
import type { RpcProjectedMessage, RpcSessionSnapshot } from "@acepe/contracts";
import {
	ActivityId,
	ApprovalRequestId,
	emptyRpcSessionSnapshot,
	ProjectId,
	SessionId,
	ToolCallId,
	TurnId,
} from "@acepe/contracts";

import { isNewerGraphRevision } from "../../store/envelope-reducer/graph-revision-order.js";
import {
	canonicalAgentIdFromString,
	graphFromReopenSnapshot,
	reopenGraphRevisionForApply,
} from "../reopen-snapshot-graph.js";

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
			providerSessionId: null,
			providerSessionFailed: false,
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

	// AC-263, reopen half: a reopened session's `snapshot.activities` (server
	// projection_session_activities, same shape agent-panel-conversation.ts's
	// scaffold already interleaves by `sequence`) must seed a `role: "tool"`
	// transcript entry plus its linked OperationSnapshot, positioned at its
	// real sequence position among the user/assistant messages -- not left
	// out, and not appended after everything else.
	it("interleaves activities into transcript entries by sequence and seeds a linked operation for each", () => {
		const snapshot: RpcSessionSnapshot = {
			...withMessages(3, [
				{
					sessionId: SESSION_ID,
					sequence: 1,
					messageId: "msg-user-1",
					turnId: null,
					rowType: "user",
					content: { text: "Read package.json and tell me its name" },
				},
				{
					sessionId: SESSION_ID,
					sequence: 3,
					messageId: "msg-assistant-1",
					turnId: TURN_ID,
					rowType: "assistant",
					content: { text: "The name is acepe" },
				},
			]),
			activities: [
				{
					activityId: ActivityId.make("activity-1"),
					sessionId: SESSION_ID,
					sequence: 2,
					kind: "tool",
					status: "completed",
					title: "Read package.json",
					path: "package.json",
					toolCallId: ToolCallId.make("tool-1"),
				},
			],
		};

		const graph = graphFromReopenSnapshot(baseInput(snapshot));

		expect(graph.transcriptSnapshot.entries.map((entry) => entry.entryId)).toEqual([
			"msg-user-1",
			"activity-1",
			"msg-assistant-1",
		]);
		const toolEntry = graph.transcriptSnapshot.entries[1];
		expect(toolEntry?.role).toBe("tool");

		expect(graph.operations).toHaveLength(1);
		const [operation] = graph.operations;
		expect(operation?.tool_call_id).toBe("tool-1");
		expect(operation?.title).toBe("Read package.json");
		expect(operation?.operation_state).toBe("completed");
		expect(operation?.source_link).toEqual({ kind: "transcript_linked", entry_id: "activity-1" });
		expect(operation?.locations).toEqual([{ path: "package.json" }]);
	});

	// #273, reopen half: a tool call's output now rides the snapshot activity
	// row (RpcProjectedSessionActivity.output), so a reopened session must
	// seed the same operation.result the live bridge sets -- AGENTS.md's rule
	// that a historical session reconnects after snapshot hydration means both
	// paths carry the same canonical facts, not one of them.
	it("carries a historical activity's output onto the operation it seeds", () => {
		const snapshot: RpcSessionSnapshot = {
			...withMessages(2, []),
			activities: [
				{
					activityId: ActivityId.make("activity-1"),
					sessionId: SESSION_ID,
					sequence: 1,
					kind: "tool",
					status: "completed",
					title: "Read package.json",
					path: "package.json",
					toolCallId: ToolCallId.make("tool-1"),
					output: '{ "name": "acepe" }',
				},
			],
		};

		const graph = graphFromReopenSnapshot(baseInput(snapshot));

		expect(graph.operations).toHaveLength(1);
		expect(graph.operations[0]?.result).toBe('{ "name": "acepe" }');
	});

	it("leaves the seeded operation result null when the activity carries no output", () => {
		const snapshot: RpcSessionSnapshot = {
			...withMessages(2, []),
			activities: [
				{
					activityId: ActivityId.make("activity-1"),
					sessionId: SESSION_ID,
					sequence: 1,
					kind: "tool",
					status: "completed",
					title: "Read package.json",
					path: "package.json",
					toolCallId: ToolCallId.make("tool-1"),
				},
			],
		};

		const graph = graphFromReopenSnapshot(baseInput(snapshot));

		expect(graph.operations[0]?.result).toBeNull();
	});

	// AC-263 issue #263 defect 1: the server-side projection (sessionSnapshot.ts's
	// upsertAssistant) merges every TokenAppended for one provider messageId
	// into a SINGLE RpcAssistantProjectedMessage row -- text streamed before a
	// mid-turn tool call and text streamed after it land in the same row,
	// concatenated, with the row's `sequence` pinned to the FIRST token (so it
	// sits before the tool activity's own, later sequence). The live path
	// (orchestration-canonical-bridge.ts) instead splits into two transcript
	// entries around the tool call; the reopen seed cannot recover that split
	// (the character offset is lost once the server merges the row), so it
	// must at least preserve the full merged text adjacent to the tool row --
	// never truncate to a prefix.
	it("keeps the full merged assistant text when a tool activity's sequence sits after the message row's", () => {
		const snapshot: RpcSessionSnapshot = {
			...withMessages(16, [
				{
					sessionId: SESSION_ID,
					sequence: 10,
					messageId: "msg-user-1",
					turnId: null,
					rowType: "user",
					content: {
						text: "Read the file package.json in this project and tell me its name field",
					},
				},
				{
					sessionId: SESSION_ID,
					sequence: 12,
					messageId: "msg-assistant-1",
					turnId: TURN_ID,
					rowType: "assistant",
					content: {
						text: "I'll read the package.json file.The `name` field is **`verify-fixture-project`**.",
					},
				},
			]),
			activities: [
				{
					activityId: ActivityId.make("activity-1"),
					sessionId: SESSION_ID,
					sequence: 15,
					kind: "tool",
					status: "completed",
					title: "Read",
					path: "package.json",
					toolCallId: ToolCallId.make("tool-1"),
				},
			],
		};

		const graph = graphFromReopenSnapshot(baseInput(snapshot));

		expect(graph.transcriptSnapshot.entries.map((entry) => entry.entryId)).toEqual([
			"msg-user-1",
			"msg-assistant-1",
			"activity-1",
		]);
		const assistantEntry = graph.transcriptSnapshot.entries[1];
		expect(assistantEntry?.segments).toEqual([
			{
				kind: "text",
				segmentId: "msg-assistant-1-text",
				text: "I'll read the package.json file.The `name` field is **`verify-fixture-project`**.",
			},
		]);
		const toolEntry = graph.transcriptSnapshot.entries[2];
		expect(toolEntry?.role).toBe("tool");
	});

	// AC-263 issue #263 defect 2: graphFromReopenSnapshot always stamps
	// graphRevision: 0 (there is no Rust-owned graphRevision counter behind
	// the Electrobun RPC snapshot -- unlike the Tauri-era SessionOpenFound
	// path's graphFromSessionOpenFound, which carries a real one). Compared
	// naively via isNewerGraphRevision, a reopen can therefore never outrank
	// a local graph that has already advanced past graphRevision 0 (e.g. via
	// live deltas), even when the reopen's own transcriptRevision is
	// genuinely newer -- turns completed after the first hydration never
	// reappear. reopenGraphRevisionForApply mirrors session-open-snapshot-
	// applier's "snapshot wins if strictly newer" semantics instead of only
	// applying when the local graph starts empty.
	describe("reopenGraphRevisionForApply", () => {
		it("applies the reopen graph as-is when there is no current graph yet", () => {
			const snapshot = withMessages(6, []);
			const graph = graphFromReopenSnapshot(baseInput(snapshot));

			expect(reopenGraphRevisionForApply(graph, null)).toEqual(graph.revision);
		});

		it("computes a revision that wins over a current graph whose transcript is strictly older", () => {
			const snapshot = withMessages(20, []);
			const graph = graphFromReopenSnapshot(baseInput(snapshot));
			const currentRevision = { graphRevision: 3, transcriptRevision: 5, lastEventSeq: 9 };

			const nextRevision = reopenGraphRevisionForApply(graph, currentRevision);

			expect(nextRevision).not.toBeNull();
			expect(isNewerGraphRevision(currentRevision, nextRevision as typeof currentRevision)).toBe(
				true
			);
		});

		it("refuses to apply (returns null) when the current graph's transcript is already at least as new", () => {
			const snapshot = withMessages(2, []);
			const graph = graphFromReopenSnapshot(baseInput(snapshot));
			const currentRevision = { graphRevision: 1, transcriptRevision: 5, lastEventSeq: 5 };

			expect(reopenGraphRevisionForApply(graph, currentRevision)).toBeNull();
		});

		it("still never lets a stale reopen snapshot stomp a newer live graph (row-wipe protection)", () => {
			const staleSnapshot = withMessages(2, []);
			const staleGraph = graphFromReopenSnapshot(baseInput(staleSnapshot));
			const liveGraphRevision = { graphRevision: 1, transcriptRevision: 5, lastEventSeq: 5 };

			expect(reopenGraphRevisionForApply(staleGraph, liveGraphRevision)).toBeNull();
		});
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

	// #268 defect 2, reopen half: activity alone told the composer to go
	// quiet, but there was nothing in the transcript to answer -- interactions
	// stayed permanently []. A reopened session with a still-pending approval
	// must render and stay answerable, exactly like one that hit the approval
	// while already open (orchestration-canonical-bridge.ts's
	// onApprovalRequested).
	it("seeds a tool-shaped transcript row, a linked operation, and an answerable interaction for a pending approval", () => {
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

		expect(graph.transcriptSnapshot.entries).toHaveLength(1);
		const [entry] = graph.transcriptSnapshot.entries;
		expect(entry?.role).toBe("tool");

		expect(graph.operations).toHaveLength(1);
		const [operation] = graph.operations;
		expect(operation?.tool_call_id).toBe(APPROVAL_REQUEST_ID);
		expect(operation?.source_link).toEqual({
			kind: "transcript_linked",
			entry_id: entry?.entryId,
		});

		expect(graph.interactions).toHaveLength(1);
		const [interaction] = graph.interactions;
		expect(interaction?.kind).toBe("Permission");
		if (interaction === undefined || !("Permission" in interaction.payload)) {
			throw new Error("expected a Permission interaction");
		}
		// permission-store.svelte.ts's getForToolCall keys strictly on this
		// field -- without it the row renders but Allow/Deny never attaches.
		expect(interaction.payload.Permission.tool?.callId).toBe(APPROVAL_REQUEST_ID);
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
