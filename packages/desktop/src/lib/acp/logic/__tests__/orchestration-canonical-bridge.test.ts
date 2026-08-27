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
	UsageTelemetryData,
} from "../../../services/acp-types.js";
import { routeSessionStateEnvelope } from "../../session-state/session-state-command-router.js";
import { buildCanonicalUsageTelemetry } from "../../store/envelope-reducer/canonical-usage-telemetry.js";
import type { AcpEventEnvelope } from "../acp-event-bridge.js";
import { OrchestrationCanonicalBridge } from "../orchestration-canonical-bridge.js";

const commandId = CommandId.make("cmd-1");
const projectId = ProjectId.make("project-1");
const sessionId = SessionId.make("session-1");
const occurredAt = "2026-08-24T12:00:00.000Z";
const usageEventId = "codex-token-usage:thread-1:turn-1:total=168:input=120:output=48";

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

function telemetryFrom(envelopes: ReadonlyArray<AcpEventEnvelope>): UsageTelemetryData {
	const payload = envelopes[0]?.payload as SessionStateEnvelope | undefined;
	if (payload === undefined || payload.payload.kind !== "telemetry") {
		throw new Error("expected a telemetry envelope");
	}
	return payload.payload.telemetry;
}

describe("OrchestrationCanonicalBridge", () => {
	/**
	 * A subscription that starts mid-stream never sees the session's
	 * `SessionCreated`. Measured against a real Claude Code session: the server
	 * emitted five ToolCallObserved and one ApprovalRequested, its snapshot
	 * carried both activities and the pending approval, and the panel showed
	 * two rows. Every canonical event for the session was discarded here,
	 * silently, because the session was not in the map -- and the reopen
	 * hydration could not repair it, because the local transcript revision was
	 * no older than the snapshot's.
	 *
	 * Canonical truth may not be dropped for want of an earlier event. Every
	 * payload names its session, which is all this bridge needs.
	 */
	it("renders a tool call for a session whose SessionCreated it never saw", () => {
		const bridge = makeBridge();
		const messageId = MessageId.make("message-mid-stream");

		runTranslate(bridge, makeEvent("MessageSent", { sessionId, messageId, text: "ship it" }));
		const envelopes = runTranslate(
			bridge,
			makeEvent("ToolCallObserved", {
				sessionId,
				activityId: "tool-1:activity",
				toolCallId: "tool-1",
				operationId: null,
				status: "in_progress",
				title: "Bash",
				path: null,
				kind: "execute",
			})
		);

		expect(envelopes.length).toBeGreaterThan(0);
		expect(JSON.stringify(envelopes)).toContain('"role":"tool"');
	});

	it("keeps a permission answerable for a session whose SessionCreated it never saw", () => {
		const bridge = makeBridge();

		const envelopes = runTranslate(
			bridge,
			makeEvent("ApprovalRequested", {
				sessionId,
				approvalRequestId: "perm-tool-1",
				title: "execute",
			})
		);

		expect(envelopes.length).toBeGreaterThan(0);
	});

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

	// #272: `currentModeId` is canonical-owned and folded from SessionModeSet,
	// which can only ever come AFTER the SessionCreated that opens the session --
	// so a live-created session has no canonical mode yet, and SessionCreatedPayload
	// (sessionId/projectId/title/providerId) carries none to seed one from. The
	// empty capabilities are the correct answer, not a gap: `modes` staying absent
	// is what lets the provider's opening mode stand, because
	// capability-projection.ts's `mapGraphAvailableModes` reports the
	// provider-owned `availableModes` as null ("not known yet") only while `modes`
	// itself is absent.
	it("opens a live-created session with no canonical mode, so the provider's opening mode stands", () => {
		const bridge = makeBridge();
		const envelopes = runTranslate(
			bridge,
			makeEvent("SessionCreated", { sessionId, projectId, title: "First session" })
		);

		const payload = envelopes[0]?.payload as SessionStateEnvelope;
		if (payload.payload.kind !== "snapshot") {
			throw new Error("expected a snapshot envelope");
		}
		expect(payload.payload.graph.capabilities.modes ?? null).toBe(null);
	});

	/**
	 * These three cases used to assert the opposite: that an event for an
	 * unknown session produced nothing. A real Claude Code session showed what
	 * that costs. A subscription starting mid-stream misses `SessionCreated`,
	 * and from then on every token, tool call and approval for a live turn was
	 * discarded here while the server had already committed all of them.
	 * "Nothing happened" is not a truthful answer to canonical truth.
	 */
	it("renders a token for a session it never saw created", () => {
		const bridge = makeBridge();
		const envelopes = runTranslate(
			bridge,
			makeEvent("TokenAppended", { sessionId, messageId: MessageId.make("m1"), token: "hello" })
		);
		expect(envelopes.length).toBeGreaterThan(0);
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

	// AC-269: the Claude Code working line's elapsed timer reads
	// SessionGraphActivity.kindStartedAtMs -- MessageSent must stamp the
	// awaiting_model activity with the turn's real start time (parsed from
	// the event's own occurredAt, not client Date.now(), so a reopened panel
	// mid-turn is not skewed by request latency).
	it("stamps the awaiting_model activity with the turn's real start time on MessageSent", () => {
		const bridge = makeBridge();
		runTranslate(bridge, makeEvent("SessionCreated", { sessionId, projectId, title: "s" }));
		const envelopes = runTranslate(
			bridge,
			makeEvent("MessageSent", { sessionId, messageId: MessageId.make("user-1"), text: "hi there" })
		);
		const payload = envelopes[0]?.payload as SessionStateEnvelope;
		if (payload.payload.kind === "delta") {
			expect(payload.payload.delta.activity.kind).toBe("awaiting_model");
			expect(payload.payload.delta.activity.kindStartedAtMs).toBe(Date.parse(occurredAt));
		}
	});

	it("clears the turn start time once the turn ends", () => {
		const bridge = makeBridge();
		runTranslate(bridge, makeEvent("SessionCreated", { sessionId, projectId, title: "s" }));
		runTranslate(
			bridge,
			makeEvent("MessageSent", { sessionId, messageId: MessageId.make("user-1"), text: "hi there" })
		);
		const envelopes = runTranslate(
			bridge,
			makeEvent("TurnCompleted", { sessionId, turnId: "user-1" })
		);
		const payload = envelopes[0]?.payload as SessionStateEnvelope;
		if (payload.payload.kind === "delta") {
			expect(payload.payload.delta.activity.kindStartedAtMs ?? null).toBeNull();
		}
	});

	// AC-269: a real usage reading must reach the SAME "telemetry" envelope /
	// applyTelemetry command / setUsageTelemetry patch chain the model-selector
	// metrics chip already reads from (session-envelope-applier.svelte.ts's
	// updateUsageTelemetry), so the working line can show the running turn's
	// tokens without a new plumbing path.
	it("emits a telemetry envelope for TurnUsageObserved, deriving total from input+output", () => {
		const bridge = makeBridge();
		runTranslate(bridge, makeEvent("SessionCreated", { sessionId, projectId, title: "s" }));
		const envelopes = runTranslate(
			bridge,
			makeEvent("TurnUsageObserved", {
				sessionId,
				turnId: "user-1",
				inputTokens: 120,
				outputTokens: 48,
				costUsd: 0.0123,
				contextWindowSize: 200_000,
			})
		);
		expect(envelopes).toHaveLength(1);
		const payload = envelopes[0]?.payload as SessionStateEnvelope;
		expect(payload.payload.kind).toBe("telemetry");
		if (payload.payload.kind === "telemetry") {
			expect(payload.payload.telemetry.sessionId).toBe(sessionId);
			expect(payload.payload.telemetry.tokens?.input).toBe(120);
			expect(payload.payload.telemetry.tokens?.output).toBe(48);
			expect(payload.payload.telemetry.tokens?.total).toBe(168);
			expect(payload.payload.telemetry.costUsd).toBe(0.0123);
			expect(payload.payload.telemetry.contextWindowSize).toBe(200_000);
		}
	});

	// #274: canonical-usage-telemetry.ts dedups a usage reading on
	// lastTelemetryEventId, and Codex/Copilot already derive a deterministic
	// eventId for the reading -- but the key died at this bridge, which never
	// set one on UsageTelemetryData, so the dedup could never fire and a
	// redelivered reading double-counted the turn's spend.
	it("carries the usage reading's own eventId onto the telemetry envelope", () => {
		const bridge = makeBridge();
		runTranslate(bridge, makeEvent("SessionCreated", { sessionId, projectId, title: "s" }));
		const envelopes = runTranslate(
			bridge,
			makeEvent("TurnUsageObserved", {
				sessionId,
				turnId: "user-1",
				inputTokens: 120,
				outputTokens: 48,
				eventId: usageEventId,
			})
		);
		expect(telemetryFrom(envelopes).eventId).toBe(usageEventId);
	});

	it("applies a redelivered usage reading once, not twice", () => {
		const bridge = makeBridge();
		runTranslate(bridge, makeEvent("SessionCreated", { sessionId, projectId, title: "s" }));
		const reading = {
			sessionId,
			turnId: "user-1",
			inputTokens: 120,
			outputTokens: 48,
			costUsd: 0.5,
			eventId: usageEventId,
		};
		const first = telemetryFrom(runTranslate(bridge, makeEvent("TurnUsageObserved", reading)));
		const second = telemetryFrom(runTranslate(bridge, makeEvent("TurnUsageObserved", reading)));

		const applied = buildCanonicalUsageTelemetry(first, undefined, null, 1000);
		expect(applied?.sessionSpendUsd).toBe(0.5);
		expect(applied?.lastTelemetryEventId).toBe(usageEventId);
		expect(buildCanonicalUsageTelemetry(second, applied ?? undefined, null, 2000)).toBeNull();
	});

	it("still applies a second usage reading that carries a different eventId", () => {
		const bridge = makeBridge();
		runTranslate(bridge, makeEvent("SessionCreated", { sessionId, projectId, title: "s" }));
		const first = telemetryFrom(
			runTranslate(
				bridge,
				makeEvent("TurnUsageObserved", { sessionId, outputTokens: 48, eventId: usageEventId })
			)
		);
		const second = telemetryFrom(
			runTranslate(
				bridge,
				makeEvent("TurnUsageObserved", {
					sessionId,
					outputTokens: 96,
					eventId: `${usageEventId}:2`,
				})
			)
		);

		const applied = buildCanonicalUsageTelemetry(first, undefined, null, 1000);
		expect(buildCanonicalUsageTelemetry(second, applied ?? undefined, null, 2000)).not.toBeNull();
	});

	it("reports usage for a session it never saw created", () => {
		const bridge = makeBridge();
		const envelopes = runTranslate(
			bridge,
			makeEvent("TurnUsageObserved", { sessionId, outputTokens: 12 })
		);
		expect(envelopes.length).toBeGreaterThan(0);
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

	// #273 client half: a tool call's output is canonical product truth that
	// now rides the observation itself (ToolCallObservedPayload.output). This
	// bridge used to hardcode `result: null`, so a completed tool call reached
	// the transcript with nothing for transcript-viewport-row-mapper.ts's
	// jsonValueTextSummary(operation.result) to render as stdout/resultSummary.
	it("carries a tool call's output onto the operation it patches", () => {
		const bridge = makeBridge();
		runTranslate(bridge, makeEvent("SessionCreated", { sessionId, projectId, title: "s" }));

		const envelopes = runTranslate(
			bridge,
			makeEvent("ToolCallObserved", {
				sessionId,
				activityId: "activity-1",
				toolCallId: "tool-1",
				operationId: null,
				status: "completed",
				title: "Read package.json",
				path: "package.json",
				output: '{ "name": "acepe" }',
			})
		);

		const payload = envelopes[0]?.payload as SessionStateEnvelope;
		expect(payload.payload.kind).toBe("delta");
		if (payload.payload.kind !== "delta") {
			throw new Error("expected a delta envelope");
		}
		const [operation] = payload.payload.delta.operationPatches;
		expect(operation?.result).toBe('{ "name": "acepe" }');
	});

	// An observation that carries no output at all -- every tool call's start
	// event, and any event appended before the field existed -- must still
	// leave the operation's result null rather than an empty string.
	it("leaves the operation result null when the observation carries no output", () => {
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

		const payload = envelopes[0]?.payload as SessionStateEnvelope;
		if (payload.payload.kind !== "delta") {
			throw new Error("expected a delta envelope");
		}
		const [operation] = payload.payload.delta.operationPatches;
		expect(operation?.result).toBeNull();
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
		expect(operation?.source_link).toEqual({
			kind: "transcript_linked",
			entry_id: approvalEntryId,
		});

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

	// AC-280: a real Claude permission id is always perm-<toolCallId> --
	// see permissionIdForToolCall in the server's Claude/Cursor/Copilot Tools.ts.
	// When Claude reports the tool call (ToolCallObserved) before it blocks on
	// permission (the normal live order: the owner's own DB evidence showed
	// ONE projection_session_activities row and a perm-<sameToolCallId>
	// pending approval for it), onApprovalRequested used to append a SECOND,
	// duplicate transcript row/operation for the exact same tool call instead
	// of recognizing the row already exists -- one operation rendered twice,
	// with the real row's PermissionBar never attaching (its toolCallId,
	// "toolu_1", never matched the permission's own id, "perm-toolu_1").
	it("attaches a permission whose id is perm-<toolCallId> to the existing tool-call row instead of duplicating it", () => {
		const bridge = makeBridge();
		runTranslate(bridge, makeEvent("SessionCreated", { sessionId, projectId, title: "s" }));

		const toolCall = runTranslate(
			bridge,
			makeEvent("ToolCallObserved", {
				sessionId,
				activityId: "activity-1",
				toolCallId: "toolu_1",
				operationId: null,
				status: "pending",
				title: "Write",
				path: "/tmp/qa.txt",
			})
		);
		const toolPayload = toolCall[0]?.payload as SessionStateEnvelope;
		const toolDelta = toolPayload.payload.kind === "delta" ? toolPayload.payload.delta : null;
		if (toolDelta === null) {
			throw new Error("expected a delta envelope");
		}
		const [toolOp] = toolDelta.transcriptOperations;
		if (toolOp?.kind !== "appendEntry") {
			throw new Error("expected the ToolCallObserved to append a tool row");
		}

		const approval = runTranslate(
			bridge,
			makeEvent("ApprovalRequested", {
				sessionId,
				approvalRequestId: "perm-toolu_1",
				title: "Write",
			})
		);
		const approvalPayload = approval[0]?.payload as SessionStateEnvelope;
		if (approvalPayload.payload.kind !== "delta") {
			throw new Error("expected a delta envelope");
		}
		const delta = approvalPayload.payload.delta;

		// One tool call, one row: no second transcript entry and no second
		// operation for the same underlying toolu_1.
		expect(delta.transcriptOperations).toHaveLength(0);
		expect(delta.operationPatches).toHaveLength(0);

		expect(delta.interactionPatches).toHaveLength(1);
		const [interaction] = delta.interactionPatches;
		if (interaction === undefined || !("Permission" in interaction.payload)) {
			throw new Error("expected a Permission interaction");
		}
		// getForToolCall matches on this field against the REAL row's
		// toolCallId ("toolu_1"), not the permission's own id
		// ("perm-toolu_1") -- otherwise the existing tool row's PermissionBar
		// never attaches, even though a row for it is already on screen.
		expect(interaction.payload.Permission.tool?.callId).toBe("toolu_1");
		expect(interaction.tool_reference).toEqual({ callId: "toolu_1" });
	});

	// The answer to an approval is canonical: the server removes the row on
	// InteractionReplied (ProjectionPendingApprovals) and the snapshot fold
	// drops it from pendingApprovals (packages/contracts/src/sessionSnapshot
	// .ts). The bridge used to have no case for the event at all, so the
	// client's interaction graph kept the permission Pending forever. A live
	// QA run showed the backend at pendingApprovals=[], the edit activity
	// completed and the file written on disk, while the transcript still
	// rendered "Permission Required" and "Waiting for your approval". The
	// client must resolve the interaction from the canonical answer instead of
	// depending on permission-store's optimistic local delete, which only
	// fires in the tab that happened to click the button.
	it("resolves the pending permission and releases the blocked activity on InteractionReplied", () => {
		const bridge = makeBridge();
		runTranslate(bridge, makeEvent("SessionCreated", { sessionId, projectId, title: "s" }));
		runTranslate(
			bridge,
			makeEvent("MessageSent", { sessionId, messageId: MessageId.make("u1"), text: "go" })
		);
		runTranslate(
			bridge,
			makeEvent("ToolCallObserved", {
				sessionId,
				activityId: "activity-1",
				toolCallId: "toolu_1",
				operationId: null,
				status: "pending",
				title: "Write",
				path: "/tmp/qa.txt",
			})
		);
		const requested = runTranslate(
			bridge,
			makeEvent("ApprovalRequested", {
				sessionId,
				approvalRequestId: "perm-toolu_1",
				title: "Write",
			})
		);
		const requestedPayload = requested[0]?.payload as SessionStateEnvelope;
		if (requestedPayload.payload.kind !== "delta") {
			throw new Error("expected a delta envelope");
		}
		expect(requestedPayload.payload.delta.activity.kind).toBe("waiting_for_user");

		const replied = runTranslate(
			bridge,
			makeEvent("InteractionReplied", {
				sessionId,
				approvalRequestId: "perm-toolu_1",
				decision: "allow",
			})
		);

		expect(replied).toHaveLength(1);
		const payload = replied[0]?.payload as SessionStateEnvelope;
		if (payload.payload.kind !== "delta") {
			throw new Error("expected a delta envelope");
		}
		const delta = payload.payload.delta;

		expect(delta.interactionPatches).toHaveLength(1);
		const [interaction] = delta.interactionPatches;
		expect(interaction?.id).toBe("perm-toolu_1");
		// interaction-store.svelte.ts's applyPermissionInteraction deletes the
		// pending permission for any state that is not "Pending". That is the
		// seam that finally takes the PermissionBar off the row.
		expect(interaction?.state).toBe("Approved");
		expect(interaction?.tool_reference).toEqual({ callId: "toolu_1" });
		expect(interaction?.response).toEqual({ kind: "permission", accepted: true });

		// "Waiting for your approval" is rendered from activity.kind
		// "waiting_for_user" (session-status-mapper.ts), so the answer has to
		// release the activity too, or the placeholder outlives its own
		// permission.
		expect(delta.activity.kind).not.toBe("waiting_for_user");
		expect(delta.changedFields).toContain("interactions");
		expect(delta.changedFields).toContain("activity");
		// Answering an approval appends no transcript row: the row it belongs
		// to is already on screen.
		expect(delta.transcriptOperations).toHaveLength(0);
		expect(delta.toRevision.transcriptRevision).toBe(delta.fromRevision.transcriptRevision);
	});

	it("marks a denied permission Rejected", () => {
		const bridge = makeBridge();
		runTranslate(bridge, makeEvent("SessionCreated", { sessionId, projectId, title: "s" }));
		runTranslate(
			bridge,
			makeEvent("ApprovalRequested", {
				sessionId,
				approvalRequestId: "perm-toolu_9",
				title: "Write",
			})
		);

		const replied = runTranslate(
			bridge,
			makeEvent("InteractionReplied", {
				sessionId,
				approvalRequestId: "perm-toolu_9",
				decision: "deny",
			})
		);

		const payload = replied[0]?.payload as SessionStateEnvelope;
		if (payload.payload.kind !== "delta") {
			throw new Error("expected a delta envelope");
		}
		const [interaction] = payload.payload.delta.interactionPatches;
		expect(interaction?.state).toBe("Rejected");
		expect(interaction?.response).toEqual({ kind: "permission", accepted: false });
	});

	it("still renders its own standalone row when no tool-call row exists yet, even for a perm-<toolCallId> id", () => {
		const bridge = makeBridge();
		runTranslate(bridge, makeEvent("SessionCreated", { sessionId, projectId, title: "s" }));

		const approval = runTranslate(
			bridge,
			makeEvent("ApprovalRequested", {
				sessionId,
				approvalRequestId: "perm-toolu_2",
				title: "Write",
			})
		);
		const payload = approval[0]?.payload as SessionStateEnvelope;
		if (payload.payload.kind !== "delta") {
			throw new Error("expected a delta envelope");
		}
		const delta = payload.payload.delta;

		expect(delta.transcriptOperations).toHaveLength(1);
		expect(delta.operationPatches).toHaveLength(1);
		expect(delta.operationPatches[0]?.tool_call_id).toBe("perm-toolu_2");
		expect(delta.interactionPatches[0]?.payload).toMatchObject({
			Permission: { tool: { callId: "perm-toolu_2" } },
		});
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

	it("closes the turn for a session it never saw created", () => {
		const bridge = makeBridge();
		const envelopes = runTranslate(bridge, makeEvent("TurnCompleted", { sessionId }));
		expect(envelopes.length).toBeGreaterThan(0);
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
	/**
	 * A usage reading arriving mid-turn used to spend a graph revision. Nothing
	 * downstream can adopt it: a telemetry envelope carries no state the client
	 * applies, so the client stays where it was while the bridge moves on. Every
	 * delta after it then starts one revision ahead of the client, the router
	 * reads that as a frontier mismatch, and the session refreshes forever.
	 *
	 * Measured on a real Claude Code turn: the refreshes began at the usage
	 * reading between two tool observations, and the second tool call and the
	 * permission request that followed were never applied. The panel showed one
	 * tool row stuck at "Executing..." while the server had both tools and a
	 * pending approval.
	 */
	it("keeps applying after a usage reading arrives between tool observations", () => {
		const bridge = makeBridge();
		let currentRevision: SessionGraphRevision | null = null;
		let refreshes = 0;
		let appended = 0;

		function apply(envelope: SessionStateEnvelope): void {
			for (const command of routeSessionStateEnvelope(sessionId, currentRevision, envelope)) {
				if (command.kind === "replaceGraph") {
					currentRevision = command.graph.revision;
				} else if (command.kind === "applyTranscriptDelta") {
					currentRevision = command.revision;
					appended += command.delta.operations.filter((op) => op.kind === "appendEntry").length;
				} else if (command.kind === "applyGraphPatches") {
					currentRevision = command.revision;
				} else if (command.kind === "refreshSnapshot") {
					refreshes += 1;
				}
			}
		}

		const observe = (toolCallId: string, status: "in_progress" | "completed") =>
			makeEvent("ToolCallObserved", {
				sessionId,
				activityId: `${toolCallId}:activity`,
				toolCallId,
				operationId: null,
				status,
				title: "Bash",
				path: null,
				kind: "execute",
			});

		for (const event of [
			makeEvent("SessionCreated", { sessionId, projectId, title: "s", providerId: "claude-code" }),
			makeEvent("MessageSent", {
				sessionId,
				messageId: MessageId.make("m-usage"),
				text: "run it",
			}),
			observe("tool-a", "in_progress"),
			makeEvent("TurnUsageObserved", { sessionId, inputTokens: 2, outputTokens: 17 }),
			observe("tool-a", "completed"),
			observe("tool-b", "in_progress"),
		]) {
			for (const produced of runTranslate(bridge, event)) {
				apply(produced.payload as SessionStateEnvelope);
			}
		}

		expect(refreshes).toBe(0);
		expect(appended).toBe(3);
	});

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
