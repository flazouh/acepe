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

import type { SessionStateDelta, SessionStateEnvelope } from "../../../services/acp-types.js";
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
			// Not transcript-bearing: transcriptRevision must not advance.
			expect(toolPayload.payload.delta.toRevision.transcriptRevision).toBe(
				toolPayload.payload.delta.fromRevision.transcriptRevision
			);
		} else {
			throw new Error("expected a delta envelope");
		}

		if (approvalPayload.payload.kind === "delta") {
			expect(approvalPayload.payload.delta.interactionPatches[0]?.id).toBe("approval-1");
			expect(approvalPayload.payload.delta.interactionPatches[0]?.kind).toBe("Permission");
		} else {
			throw new Error("expected a delta envelope");
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
