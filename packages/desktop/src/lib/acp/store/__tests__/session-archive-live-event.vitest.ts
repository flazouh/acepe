/**
 * Archived-ness arrives on the live orchestration stream.
 *
 * Archiving used to leave the sidebar only because the two components that
 * dispatch it re-read the whole library snapshot afterwards. The canonical
 * fact was already on its way: the server commits SessionArchived, the
 * orchestration events stream carries it into the webview, and
 * OrchestrationCanonicalBridge translates it. These tests pin that path --
 * event in, `archivedAt` on the SessionCold row, row gone from the list the
 * sidebar renders -- so no caller has to ask for the snapshot again.
 */

import { CommandId, EventId, type OrchestrationEvent, SessionId } from "@acepe/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({
	api: {
		getSession: vi.fn(),
		scanSessions: vi.fn(),
		sendPrompt: vi.fn(),
		setSessionTitle: vi.fn(),
	},
}));

import type { SessionStateEnvelope } from "../../../services/acp-types.js";
import { selectActiveSessions } from "../../application/dto/session-archive.js";
import { OrchestrationCanonicalBridge } from "../../logic/orchestration-canonical-bridge.js";
import { SessionStore } from "../session-store.svelte.js";

const sessionId = SessionId.make("session-archive-live");
const commandId = CommandId.make("cmd-archive-live");
const projectPath = "/project";
const archivedAt = "2026-08-30T12:00:00.000Z";

function orchestrationEvent(
	type: "SessionArchived" | "SessionUnarchived",
	sequence: number,
	occurredAt: string
): OrchestrationEvent {
	return {
		sequence,
		eventId: EventId.make(`event-${String(sequence)}`),
		aggregateKind: "session",
		aggregateId: sessionId,
		occurredAt,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type,
		payload: { sessionId },
	} as unknown as OrchestrationEvent;
}

function storeWithOneSession(): SessionStore {
	const store = new SessionStore();
	store.write.addSession({
		id: sessionId,
		projectPath,
		agentId: "claude-code",
		title: "Live archive",
		createdAt: new Date("2026-08-30T09:00:00.000Z"),
		updatedAt: new Date("2026-08-30T10:00:00.000Z"),
		parentId: null,
	});
	return store;
}

function deliver(
	store: SessionStore,
	bridge: OrchestrationCanonicalBridge,
	event: OrchestrationEvent
): void {
	const envelopes = Effect.runSync(bridge.translate(event));
	expect(envelopes.length).toBe(1);
	for (const envelope of envelopes) {
		store.applySessionStateEnvelope(sessionId, envelope.payload as unknown as SessionStateEnvelope);
	}
}

function visibleSessionIds(store: SessionStore): string[] {
	return selectActiveSessions(store.read.getAllSessions()).map((session) => session.id);
}

describe("archived-ness from the live orchestration stream", () => {
	it("drops the row from the sidebar list when SessionArchived arrives", () => {
		const store = storeWithOneSession();
		const bridge = new OrchestrationCanonicalBridge(() => Effect.succeed(projectPath));

		expect(visibleSessionIds(store)).toEqual([sessionId]);

		deliver(store, bridge, orchestrationEvent("SessionArchived", 1, archivedAt));

		expect(visibleSessionIds(store)).toEqual([]);
		expect(store.read.getSessionCold(sessionId)?.archivedAt?.toISOString()).toBe(archivedAt);
	});

	it("brings the row back when SessionUnarchived arrives", () => {
		const store = storeWithOneSession();
		const bridge = new OrchestrationCanonicalBridge(() => Effect.succeed(projectPath));

		deliver(store, bridge, orchestrationEvent("SessionArchived", 1, archivedAt));
		deliver(store, bridge, orchestrationEvent("SessionUnarchived", 2, "2026-08-30T13:00:00.000Z"));

		expect(visibleSessionIds(store)).toEqual([sessionId]);
		expect(store.read.getSessionCold(sessionId)?.archivedAt).toBeNull();
	});

	it("leaves the row's own updatedAt alone", () => {
		const store = storeWithOneSession();
		const bridge = new OrchestrationCanonicalBridge(() => Effect.succeed(projectPath));

		deliver(store, bridge, orchestrationEvent("SessionArchived", 1, archivedAt));

		expect(store.read.getSessionCold(sessionId)?.updatedAt.toISOString()).toBe(
			"2026-08-30T10:00:00.000Z"
		);
	});
});
