import { describe, expect, it } from "bun:test";
import {
	CommandId,
	EventId,
	MessageId,
	type OrchestrationEvent,
	ProjectId,
	SessionId,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";

import type {
	SessionGraphRevision,
	SessionStateDelta,
	SessionStateEnvelope,
} from "../../../services/acp-types.js";
import { routeSessionStateEnvelope } from "../../session-state/session-state-command-router.js";
import type { AcpEventEnvelope } from "../acp-event-bridge.js";
import { OrchestrationCanonicalBridge } from "../orchestration-canonical-bridge.js";

const commandId = CommandId.make("cmd-1");
const projectId = ProjectId.make("project-1");
const sessionId = SessionId.make("session-1");
const occurredAt = "2026-08-24T12:00:00.000Z";

let eventSeq = 0;
function makeEvent<Type extends string, Payload>(type: Type, payload: Payload): OrchestrationEvent {
	eventSeq += 1;
	return {
		sequence: eventSeq,
		eventId: EventId.make(`event-${String(eventSeq)}`),
		aggregateKind: "session",
		aggregateId: sessionId,
		occurredAt,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type,
		payload,
	} as unknown as OrchestrationEvent;
}

function makeBridge(projectPath = "/tmp/project"): OrchestrationCanonicalBridge {
	return new OrchestrationCanonicalBridge(() => Effect.succeed(projectPath));
}

function runTranslate(
	bridge: OrchestrationCanonicalBridge,
	event: OrchestrationEvent
): ReadonlyArray<AcpEventEnvelope> {
	return Effect.runSync(bridge.translate(event));
}

describe("OrchestrationCanonicalBridge", () => {
	it("emits an initial snapshot on SessionCreated, seeded at revision 0", () => {
		const bridge = makeBridge("/tmp/my-project");
		const envelopes = runTranslate(
			bridge,
			makeEvent("SessionCreated", {
				sessionId,
				projectId,
				title: "First session",
				providerId: "claude-code",
			})
		);

		expect(envelopes).toHaveLength(1);
		expect(envelopes[0]?.eventName).toBe("acp-session-state");
		const payload = envelopes[0]?.payload as SessionStateEnvelope;
		expect(payload.sessionId).toBe(sessionId);
		expect(payload.graphRevision).toBe(0);
		expect(payload.lastEventSeq).toBe(0);
		expect(payload.payload.kind).toBe("snapshot");
		if (payload.payload.kind === "snapshot") {
			expect(payload.payload.graph.canonicalSessionId).toBe(sessionId);
			expect(payload.payload.graph.projectPath).toBe("/tmp/my-project");
			expect(payload.payload.graph.agentId).toBe("claude-code");
			expect(payload.payload.graph.turnState).toBe("Idle");
			expect(payload.payload.graph.transcriptSnapshot.entries).toHaveLength(0);
		}
	});

	it("ignores events for a session it never saw created", () => {
		const bridge = makeBridge();
		const envelopes = runTranslate(
			bridge,
			makeEvent("TokenAppended", { sessionId, messageId: MessageId.make("m1"), token: "hello" })
		);
		expect(envelopes).toHaveLength(0);
	});

	it("appends a user transcript entry and advances revision on MessageSent", () => {
		const bridge = makeBridge();
		runTranslate(bridge, makeEvent("SessionCreated", { sessionId, projectId, title: "s" }));
		const envelopes = runTranslate(
			bridge,
			makeEvent("MessageSent", { sessionId, messageId: MessageId.make("user-1"), text: "hi there" })
		);

		expect(envelopes).toHaveLength(1);
		const payload = envelopes[0]?.payload as SessionStateEnvelope;
		expect(payload.graphRevision).toBe(1);
		expect(payload.lastEventSeq).toBe(1);
		expect(payload.payload.kind).toBe("delta");
		if (payload.payload.kind === "delta") {
			const delta: SessionStateDelta = payload.payload.delta;
			expect(delta.fromRevision.graphRevision).toBe(0);
			expect(delta.toRevision.graphRevision).toBe(1);
			expect(delta.turnState).toBe("Running");
			expect(delta.transcriptOperations).toHaveLength(1);
			const [op] = delta.transcriptOperations;
			expect(op?.kind).toBe("appendEntry");
			if (op?.kind === "appendEntry") {
				expect(op.entry.role).toBe("user");
				expect(op.entry.segments[0]).toEqual({
					kind: "text",
					segmentId: "seg-user-1",
					text: "hi there",
				});
			}
		}
	});

	it("creates a new assistant entry on the first token, then appends segments contiguously", () => {
		const bridge = makeBridge();
		runTranslate(bridge, makeEvent("SessionCreated", { sessionId, projectId, title: "s" }));
		const assistantMessageId = MessageId.make("assistant-1");

		const first = runTranslate(
			bridge,
			makeEvent("TokenAppended", { sessionId, messageId: assistantMessageId, token: "Hel" })
		);
		const second = runTranslate(
			bridge,
			makeEvent("TokenAppended", { sessionId, messageId: assistantMessageId, token: "lo" })
		);

		const firstPayload = first[0]?.payload as SessionStateEnvelope;
		const secondPayload = second[0]?.payload as SessionStateEnvelope;
		expect(firstPayload.graphRevision).toBe(1);
		expect(secondPayload.graphRevision).toBe(2);
		expect(secondPayload.lastEventSeq).toBe(2);

		if (firstPayload.payload.kind === "delta") {
			const [op] = firstPayload.payload.delta.transcriptOperations;
			expect(op?.kind).toBe("appendEntry");
			if (op?.kind === "appendEntry") {
				expect(op.entry.role).toBe("assistant");
			}
		} else {
			throw new Error("expected a delta envelope");
		}

		if (secondPayload.payload.kind === "delta") {
			const [op] = secondPayload.payload.delta.transcriptOperations;
			expect(op?.kind).toBe("appendSegment");
			if (op?.kind === "appendSegment") {
				expect(op.role).toBe("assistant");
				expect(op.segment).toEqual({ kind: "text", segmentId: "seg-assistant-1-1", text: "lo" });
			}
		} else {
			throw new Error("expected a delta envelope");
		}
	});

	it("keeps revisions contiguous across a mixed run of tool calls and approvals", () => {
		const bridge = makeBridge();
		runTranslate(bridge, makeEvent("SessionCreated", { sessionId, projectId, title: "s" }));
		runTranslate(
			bridge,
			makeEvent("MessageSent", { sessionId, messageId: MessageId.make("u1"), text: "go" })
		);

		const toolCall = runTranslate(
			bridge,
			makeEvent("ToolCallObserved", {
				sessionId,
				activityId: "activity-1",
				toolCallId: "tool-1",
				operationId: null,
				status: "in_progress",
				title: "Read file",
				path: null,
			})
		);
		const approval = runTranslate(
			bridge,
			makeEvent("ApprovalRequested", {
				sessionId,
				approvalRequestId: "approval-1",
				title: "Run command",
			})
		);

		const toolPayload = toolCall[0]?.payload as SessionStateEnvelope;
		const approvalPayload = approval[0]?.payload as SessionStateEnvelope;
		expect(toolPayload.graphRevision).toBe(2);
		expect(approvalPayload.graphRevision).toBe(3);
		expect(approvalPayload.lastEventSeq).toBe(3);

		if (toolPayload.payload.kind === "delta") {
			expect(toolPayload.payload.delta.operationPatches[0]?.tool_call_id).toBe("tool-1");
			// AC-263: a tool call renders as its own transcript row, so it is
			// transcript-bearing -- transcriptRevision must advance.
			expect(toolPayload.payload.delta.toRevision.transcriptRevision).toBeGreaterThan(
				toolPayload.payload.delta.fromRevision.transcriptRevision
			);
		} else {
			throw new Error("expected a delta envelope");
		}

		if (approvalPayload.payload.kind === "delta") {
			expect(approvalPayload.payload.delta.interactionPatches[0]?.id).toBe("approval-1");
			expect(approvalPayload.payload.delta.interactionPatches[0]?.kind).toBe("Permission");
			// #268 defect 2: an approval renders as its own transcript row too.
			expect(approvalPayload.payload.delta.toRevision.transcriptRevision).toBeGreaterThan(
				approvalPayload.payload.delta.fromRevision.transcriptRevision
			);
		} else {
			throw new Error("expected a delta envelope");
		}
	});

	// AC-263 client half: the server now emits real ToolCallObserved events,
	// but the transcript never showed a row for them because this bridge only
	// ever patched the operation (source_link: "synthetic") and never touched
	// transcriptSnapshot.entries. Tool rows must appear inline, in real
	// arrival order, both live and (via reopen-snapshot-graph.ts) on reopen.
	it("appends a tool transcript entry on first ToolCallObserved, transcript-linked to the operation", () => {
		const bridge = makeBridge();
		runTranslate(bridge, makeEvent("SessionCreated", { sessionId, projectId, title: "s" }));

		const envelopes = runTranslate(
			bridge,
			makeEvent("ToolCallObserved", {
				sessionId,
				activityId: "activity-1",
				toolCallId: "tool-1",
				operationId: null,
				status: "in_progress",
				title: "Read package.json",
				path: "package.json",
			})
		);

		expect(envelopes).toHaveLength(1);
		const payload = envelopes[0]?.payload as SessionStateEnvelope;
		expect(payload.payload.kind).toBe("delta");
		if (payload.payload.kind !== "delta") {
			throw new Error("expected a delta envelope");
		}
		const delta = payload.payload.delta;

		expect(delta.transcriptOperations).toHaveLength(1);
		const [op] = delta.transcriptOperations;
		expect(op?.kind).toBe("appendEntry");
		if (op?.kind !== "appendEntry") {
			throw new Error("expected an appendEntry transcript operation");
		}
		expect(op.entry.role).toBe("tool");
		const toolEntryId = op.entry.entryId;

		expect(delta.operationPatches).toHaveLength(1);
		const [operation] = delta.operationPatches;
		expect(operation?.tool_call_id).toBe("tool-1");
		expect(operation?.source_link).toEqual({ kind: "transcript_linked", entry_id: toolEntryId });

		// A tool row is transcript-bearing: transcriptRevision must advance so
		// the Electrobun rows-controller (gated on transcript-revision alone)
		// actually re-derives rows for it.
		expect(delta.toRevision.transcriptRevision).toBeGreaterThan(
			delta.fromRevision.transcriptRevision
		);
		expect(delta.changedFields).toContain("transcriptSnapshot");
	});

	it("does not append a second tool transcript entry when the same tool call is observed again, and does not falsely claim transcriptRevision advanced", () => {
		const bridge = makeBridge();
		runTranslate(bridge, makeEvent("SessionCreated", { sessionId, projectId, title: "s" }));
		const first = runTranslate(
			bridge,
			makeEvent("ToolCallObserved", {
				sessionId,
				activityId: "activity-1",
				toolCallId: "tool-1",
				operationId: null,
				status: "in_progress",
				title: "Read package.json",
				path: "package.json",
			})
		);
		const firstPayload = first[0]?.payload as SessionStateEnvelope;
		const firstDelta = firstPayload.payload.kind === "delta" ? firstPayload.payload.delta : null;
		if (firstDelta === null) {
			throw new Error("expected a delta envelope");
		}
		const [firstOp] = firstDelta.transcriptOperations;
		const toolEntryId = firstOp?.kind === "appendEntry" ? firstOp.entry.entryId : null;
		if (toolEntryId === null) {
			throw new Error("expected the first ToolCallObserved to append a tool transcript entry");
		}

		const second = runTranslate(
			bridge,
			makeEvent("ToolCallObserved", {
				sessionId,
				activityId: "activity-1",
				toolCallId: "tool-1",
				operationId: null,
				status: "completed",
				title: "Read package.json",
				path: "package.json",
			})
		);
		const secondPayload = second[0]?.payload as SessionStateEnvelope;
		if (secondPayload.payload.kind !== "delta") {
			throw new Error("expected a delta envelope");
		}
		const secondDelta = secondPayload.payload.delta;

		expect(secondDelta.transcriptOperations).toHaveLength(0);
		expect(secondDelta.operationPatches[0]?.operation_state).toBe("completed");
		expect(secondDelta.operationPatches[0]?.source_link).toEqual({
			kind: "transcript_linked",
			entry_id: toolEntryId,
		});
		// A status-only re-observation carries zero transcriptOperations, so it
		// must not claim transcriptRevision advanced or list "transcriptSnapshot"
		// in changedFields -- session-state-query-service.ts's
		// resolveSessionStateDelta treats that combination (transcriptSnapshot
		// changed, zero operations) as a stale/desynced delta and forces a
		// refreshSnapshot, silently dropping this delta's operationPatches and
		// activity instead of applying them. See the full-pipeline regression
		// test below.
		expect(secondDelta.toRevision.transcriptRevision).toBe(
			secondDelta.fromRevision.transcriptRevision
		);
		expect(secondDelta.changedFields).not.toContain("transcriptSnapshot");
		expect(secondDelta.changedFields).toContain("operations");
		expect(secondDelta.changedFields).toContain("activity");
	});

	// #268 defect 2: ApprovalRequested used to patch session.interactions ONLY
	// -- zero transcriptOperations, so a pending approval never appeared in the
	// transcript at all (the tool-row analog of the bug ToolCallObserved had
	// before AC-263). A pending approval must now render as its own actionable
	// row: an appended "tool"-role transcript entry, transcript-linked to a
	// pending operation, with the interaction's Permission.tool.callId
	// stamped to that same row id so the existing tool-call-attached
	// PermissionBar (getForToolCall) picks it up and renders Allow/Deny.
	it("appends a tool transcript entry on ApprovalRequested, with the interaction's tool reference stamped to that row", () => {
		const bridge = makeBridge();
		runTranslate(bridge, makeEvent("SessionCreated", { sessionId, projectId, title: "s" }));

		const envelopes = runTranslate(
			bridge,
			makeEvent("ApprovalRequested", {
				sessionId,
				approvalRequestId: "approval-1",
				title: "Run rm -rf build/",
			})
		);

		expect(envelopes).toHaveLength(1);
		const payload = envelopes[0]?.payload as SessionStateEnvelope;
		expect(payload.payload.kind).toBe("delta");
		if (payload.payload.kind !== "delta") {
			throw new Error("expected a delta envelope");
		}
		const delta = payload.payload.delta;

		expect(delta.transcriptOperations).toHaveLength(1);
		const [op] = delta.transcriptOperations;
		expect(op?.kind).toBe("appendEntry");
		if (op?.kind !== "appendEntry") {
			throw new Error("expected an appendEntry transcript operation");
		}
		expect(op.entry.role).toBe("tool");
		const approvalEntryId = op.entry.entryId;

		expect(delta.operationPatches).toHaveLength(1);
		const [operation] = delta.operationPatches;
		expect(operation?.tool_call_id).toBe("approval-1");
		expect(operation?.source_link).toEqual({ kind: "transcript_linked", entry_id: approvalEntryId });

		expect(delta.interactionPatches).toHaveLength(1);
		const [interaction] = delta.interactionPatches;
		expect(interaction?.kind).toBe("Permission");
		if (interaction === undefined || !("Permission" in interaction.payload)) {
			throw new Error("expected a Permission interaction");
		}
		// The row-attachment lookup (permission-store.svelte.ts's getForToolCall)
		// keys strictly on this field -- without it the row renders but the
		// Allow/Deny bar never attaches, which is exactly as broken as no row
		// at all.
		expect(interaction.payload.Permission.tool?.callId).toBe("approval-1");

		// A pending approval is transcript-bearing: transcriptRevision must
		// advance so the Electrobun rows-controller re-derives rows for it.
		expect(delta.toRevision.transcriptRevision).toBeGreaterThan(
			delta.fromRevision.transcriptRevision
		);
		expect(delta.changedFields).toContain("transcriptSnapshot");
	});

	it("starts a fresh assistant entry for tokens that arrive after a tool call, so text keeps its real position relative to the tool row", () => {
		const bridge = makeBridge();
		runTranslate(bridge, makeEvent("SessionCreated", { sessionId, projectId, title: "s" }));
		runTranslate(
			bridge,
			makeEvent("TokenAppended", { sessionId, messageId: MessageId.make("a1"), token: "Checking" })
		);
		runTranslate(
			bridge,
			makeEvent("ToolCallObserved", {
				sessionId,
				activityId: "activity-1",
				toolCallId: "tool-1",
				operationId: null,
				status: "completed",
				title: "Read package.json",
				path: "package.json",
			})
		);
		const afterTool = runTranslate(
			bridge,
			makeEvent("TokenAppended", {
				sessionId,
				messageId: MessageId.make("a1"),
				token: "It's acepe",
			})
		);

		const payload = afterTool[0]?.payload as SessionStateEnvelope;
		if (payload.payload.kind !== "delta") {
			throw new Error("expected a delta envelope");
		}
		const [op] = payload.payload.delta.transcriptOperations;
		expect(op?.kind).toBe("appendEntry");
		if (op?.kind === "appendEntry") {
			expect(op.entry.role).toBe("assistant");
			expect(op.entry.entryId).not.toBe("entry-assistant-a1");
		}
	});

	// Reproduces the live bug this bridge's own header comment documented:
	// "turn completion has no orchestration event yet ... so turnState never
	// leaves 'Running' after the first reply starts". Now that TurnCompleted
	// exists on the contract, a real Claude reply with no follow-up message
	// must resolve turnState to "Completed" and drop the composer out of its
	// busy/Interrupt state instead of staying stuck open forever.
	it("resolves turnState to Completed and clears activity on TurnCompleted", () => {
		const bridge = makeBridge();
		runTranslate(bridge, makeEvent("SessionCreated", { sessionId, projectId, title: "s" }));
		runTranslate(
			bridge,
			makeEvent("MessageSent", { sessionId, messageId: MessageId.make("u1"), text: "go" })
		);
		runTranslate(
			bridge,
			makeEvent("TokenAppended", {
				sessionId,
				messageId: MessageId.make("u1:assistant"),
				token: "TURN_42",
			})
		);

		const envelopes = runTranslate(bridge, makeEvent("TurnCompleted", { sessionId }));

		expect(envelopes).toHaveLength(1);
		const payload = envelopes[0]?.payload as SessionStateEnvelope;
		expect(payload.payload.kind).toBe("delta");
		if (payload.payload.kind === "delta") {
			const delta: SessionStateDelta = payload.payload.delta;
			expect(delta.turnState).toBe("Completed");
			expect(delta.activity.kind).toBe("idle");
			expect(delta.changedFields).toContain("turnState");
			expect(delta.changedFields).toContain("activity");
		}
	});

	it("ignores TurnCompleted for a session it never saw created", () => {
		const bridge = makeBridge();
		const envelopes = runTranslate(bridge, makeEvent("TurnCompleted", { sessionId }));
		expect(envelopes).toHaveLength(0);
	});

	it("skips event types outside its scope without throwing", () => {
		const bridge = makeBridge();
		runTranslate(bridge, makeEvent("SessionCreated", { sessionId, projectId, title: "s" }));
		const envelopes = runTranslate(
			bridge,
			makeEvent("SettingsUpdated", { key: "theme", value: "dark" })
		);
		expect(envelopes).toHaveLength(0);
	});
});

// Reproduces a live defect: during a real Claude turn with a tool call, the
// transcript stalls right after the tool call -- pre-tool text and the
// pending tool row render, but post-tool tokens, tool completion, and turn
// completion never do, even though the server appends the full
// ToolCallObserved in_progress -> in_progress(titled) -> completed sequence
// plus the TokenAppended/TurnCompleted that follow. Root cause:
// onToolCallObserved used to claim "transcriptSnapshot changed" (and bump
// transcriptRevision) on EVERY re-observation of the same tool call, not
// just its first appendEntry sighting. session-state-query-service.ts's
// resolveSessionStateDelta treats "transcriptSnapshot changed, zero
// transcriptOperations" as a stale delta and forces a refreshSnapshot, which
// (a) drops that delta's operationPatches/activity entirely --
// routeSessionStateEnvelope only emits applyGraphPatches on the
// non-refreshSnapshot path -- and (b) since this bridge's live transcript
// exists only client-side (Electrobun has no real backend snapshot to
// refresh a live-created session from), the desync never resolves: every
// later envelope for the session is treated as stale too, and the
// transcript never advances past that point. This test drives the bridge's
// output through the real session-state-command-router, the actual next
// consumer, instead of asserting on the bridge's delta shape alone.
describe("OrchestrationCanonicalBridge -> session-state-command-router (full live-turn pipeline)", () => {
	it("keeps applying transcript/graph patches across pre-tool text -> tool call -> post-tool text -> TurnCompleted, without ever falling back to refreshSnapshot", () => {
		const bridge = makeBridge();
		const appliedText: string[] = [];
		const observedToolStates: string[] = [];
		const state: {
			currentRevision: SessionGraphRevision | null;
			turnState: string | null;
			sawRefreshSnapshot: boolean;
		} = {
			currentRevision: null,
			turnState: null,
			sawRefreshSnapshot: false,
		};

		function apply(envelope: SessionStateEnvelope): void {
			const commands = routeSessionStateEnvelope(sessionId, state.currentRevision, envelope);
			for (const command of commands) {
				switch (command.kind) {
					case "replaceGraph":
						state.currentRevision = command.graph.revision;
						state.turnState = command.graph.turnState;
						break;
					case "applyTranscriptDelta":
						// Mirrors reduce-command.ts's reduceTranscriptDelta ->
						// graphWithTranscriptSnapshot: a transcript-only patch still
						// advances the graph's overall revision, even with no
						// operationPatches/activity/turnState change alongside it.
						state.currentRevision = command.revision;
						for (const op of command.delta.operations) {
							if (op.kind === "appendEntry") {
								const segment = op.entry.segments[0];
								if (segment?.kind === "text") {
									appliedText.push(segment.text);
								}
							}
							if (op.kind === "appendSegment" && op.segment.kind === "text") {
								appliedText.push(op.segment.text);
							}
						}
						break;
					case "applyGraphPatches":
						state.currentRevision = command.revision;
						if (command.turnState !== undefined) {
							state.turnState = command.turnState;
						}
						for (const op of command.operationPatches) {
							observedToolStates.push(op.operation_state ?? "unknown");
						}
						break;
					case "refreshSnapshot":
						state.sawRefreshSnapshot = true;
						break;
					default:
						break;
				}
			}
		}

		const created = runTranslate(
			bridge,
			makeEvent("SessionCreated", { sessionId, projectId, title: "s", providerId: "claude-code" })
		);
		apply(created[0]?.payload as SessionStateEnvelope);

		apply(
			runTranslate(
				bridge,
				makeEvent("MessageSent", {
					sessionId,
					messageId: MessageId.make("u1"),
					text: "Read the file package.json in this project and tell me its name field",
				})
			)[0]?.payload as SessionStateEnvelope
		);

		const preToolMessageId = MessageId.make("a1");
		apply(
			runTranslate(
				bridge,
				makeEvent("TokenAppended", { sessionId, messageId: preToolMessageId, token: "I'll" })
			)[0]?.payload as SessionStateEnvelope
		);
		apply(
			runTranslate(
				bridge,
				makeEvent("TokenAppended", {
					sessionId,
					messageId: preToolMessageId,
					token: " check that file.",
				})
			)[0]?.payload as SessionStateEnvelope
		);

		apply(
			runTranslate(
				bridge,
				makeEvent("ToolCallObserved", {
					sessionId,
					activityId: "activity-1",
					toolCallId: "tool-1",
					operationId: null,
					status: "in_progress",
					title: "Read",
					path: "package.json",
				})
			)[0]?.payload as SessionStateEnvelope
		);
		// A second observation of the SAME tool call, now carrying its resolved
		// title -- exactly what the real server sends once it fills in the
		// tool's display name after the first (bare) sighting.
		apply(
			runTranslate(
				bridge,
				makeEvent("ToolCallObserved", {
					sessionId,
					activityId: "activity-1",
					toolCallId: "tool-1",
					operationId: null,
					status: "in_progress",
					title: "Read package.json",
					path: "package.json",
				})
			)[0]?.payload as SessionStateEnvelope
		);
		apply(
			runTranslate(
				bridge,
				makeEvent("ToolCallObserved", {
					sessionId,
					activityId: "activity-1",
					toolCallId: "tool-1",
					operationId: null,
					status: "completed",
					title: "Read package.json",
					path: "package.json",
				})
			)[0]?.payload as SessionStateEnvelope
		);

		const postToolMessageId = MessageId.make("a1-post");
		apply(
			runTranslate(
				bridge,
				makeEvent("TokenAppended", { sessionId, messageId: postToolMessageId, token: "The" })
			)[0]?.payload as SessionStateEnvelope
		);
		apply(
			runTranslate(
				bridge,
				makeEvent("TokenAppended", {
					sessionId,
					messageId: postToolMessageId,
					token: " name field is acepe.",
				})
			)[0]?.payload as SessionStateEnvelope
		);

		apply(
			runTranslate(bridge, makeEvent("TurnCompleted", { sessionId }))[0]
				?.payload as SessionStateEnvelope
		);

		expect(state.sawRefreshSnapshot).toBe(false);
		expect(appliedText).toEqual([
			"Read the file package.json in this project and tell me its name field",
			"I'll",
			" check that file.",
			"Read",
			"The",
			" name field is acepe.",
		]);
		expect(observedToolStates).toEqual(["running", "running", "completed"]);
		expect(state.turnState).toBe("Completed");
	});
});
