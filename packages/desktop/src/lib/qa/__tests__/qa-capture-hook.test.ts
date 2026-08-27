import { describe, expect, it } from "bun:test";
import { OrchestrationEvent, ProjectId, SessionId } from "@acepe/contracts";
import * as Schema from "effect/Schema";
import { belongsToCapture } from "$lib/rpc/qa-capture-hook.ts";

const wanted = SessionId.make("wanted-session");
const projectId = ProjectId.make("project-1");

const decode = Schema.decodeUnknownSync(OrchestrationEvent);

const envelope = (aggregateKind: string, aggregateId: string) => ({
	sequence: 1,
	eventId: "event-1",
	aggregateKind,
	aggregateId,
	occurredAt: "2026-08-27T10:00:00.000Z",
	commandId: "command-1",
	causationEventId: null,
	correlationId: "correlation-1",
	metadata: {},
});

const sessionEvent = (sessionId: string) =>
	decode({
		...envelope("session", sessionId),
		type: "SessionCreated",
		payload: { sessionId, projectId, title: "Ship the slice" },
	});

const projectEvent = () =>
	decode({
		...envelope("project", projectId),
		type: "ProjectCreated",
		payload: { projectId, title: "Acepe", workspaceRoot: "/Users/qa/acepe" },
	});

describe("belongsToCapture", () => {
	it("keeps the session the capture was asked for", () => {
		expect(belongsToCapture(sessionEvent("wanted-session"), wanted)).toBe(true);
	});

	/**
	 * Without this the capture carried every session in the library: wrong for a
	 * scenario named after one session, and too large to move across the QA
	 * socket in one eval.
	 */
	it("drops another session's events", () => {
		expect(belongsToCapture(sessionEvent("other-session"), wanted)).toBe(false);
	});

	it("keeps what is not session-scoped, because the shell reads it while booting", () => {
		expect(belongsToCapture(projectEvent(), wanted)).toBe(true);
	});
});
