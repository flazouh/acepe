import { describe, expect, it } from "bun:test";
import {
	CommandId,
	emptyRpcSessionSnapshot,
	EventId,
	MessageId,
	type OrchestrationEvent,
	ProjectId,
	type RpcClient,
	SessionId,
	TRACER_REPLY_TEXT,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { createSessionStore } from "../../stores/session-store.svelte.ts";
import { transcriptRowsFromSnapshot } from "../../stores/session-transcript-state.ts";

const sessionId = SessionId.make("session-1");
const projectId = ProjectId.make("project-1");
const occurredAt = "2026-08-20T12:00:00.000Z";

const token: OrchestrationEvent = {
	sequence: 4,
	eventId: EventId.make("event-4"),
	aggregateKind: "session",
	aggregateId: sessionId,
	occurredAt,
	commandId: CommandId.make("cmd-1"),
	causationEventId: null,
	correlationId: CommandId.make("cmd-1"),
	metadata: {},
	type: "TokenAppended",
	payload: {
		sessionId,
		messageId: MessageId.make("message-assistant"),
		token: TRACER_REPLY_TEXT,
	},
};

describe("tracer bullet controller mapping", () => {
	it("maps the session atom to transcript rows in snapshot order", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const client: RpcClient = {
					dispatch: () => Effect.succeed({ sequence: 1 }),
					snapshot: () =>
						Effect.succeed({
							snapshotSequence: 3,
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
								prNumber: null,
								prLinkMode: null,
							},
							messages: [
								{
									sessionId,
									sequence: 3,
									messageId: MessageId.make("message-user"),
									turnId: null,
									rowType: "user",
									content: { text: "Ping" },
								},
							],
							turns: [],
							activities: [],
							pendingApprovals: [],
							checkpoints: [],
							projects: [],
							sessions: [],
							settings: [],
							skillsCatalog: null,
							voice: null,
						}),
					getProjectIndex: () =>
						Effect.succeed({
							projectPath: "/tmp/acepe",
							files: [],
							gitStatus: [],
							totalFiles: 0,
							totalLines: 0,
						}),
					invalidateProjectIndex: () => Effect.void,
					events: () => Stream.make(token),
				};
				const registry = AtomRegistry.make();
				const store = createSessionStore({ client, registry });
				yield* store.openSession(sessionId);
				const rows = transcriptRowsFromSnapshot(store.snapshot.current);
				expect(rows.map((row) => row.text)).toEqual(["Ping", TRACER_REPLY_TEXT]);
				expect(emptyRpcSessionSnapshot(0).messages).toEqual([]);
			}),
		));
});
