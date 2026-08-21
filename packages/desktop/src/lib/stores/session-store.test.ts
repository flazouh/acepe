import { describe, expect, it } from "bun:test";
import {
	CommandId,
	emptyRpcSessionSnapshot,
	EventId,
	MessageId,
	type OrchestrationEvent,
	ProjectId,
	type RpcClient,
	type RpcSessionSnapshot,
	SessionId,
	TRACER_REPLY_TEXT,
	TRACER_REPLY_TOKENS,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { createSessionStore } from "./session-store.svelte.ts";

const commandId = CommandId.make("cmd-1");
const projectId = ProjectId.make("project-1");
const sessionId = SessionId.make("session-1");
const userMessageId = MessageId.make("message-user");
const assistantMessageId = MessageId.make("message-assistant");
const occurredAt = "2026-08-20T12:00:00.000Z";

const sessionCreated: OrchestrationEvent = {
	sequence: 2,
	eventId: EventId.make("event-2"),
	aggregateKind: "session",
	aggregateId: sessionId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "SessionCreated",
	payload: {
		sessionId,
		projectId,
		title: "First session",
	},
};

const messageSent: OrchestrationEvent = {
	sequence: 3,
	eventId: EventId.make("event-3"),
	aggregateKind: "session",
	aggregateId: sessionId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "MessageSent",
	payload: {
		sessionId,
		messageId: userMessageId,
		text: "Ping",
	},
};

const tokenAt = (sequence: number, token: string): OrchestrationEvent => ({
	sequence,
	eventId: EventId.make(`event-${String(sequence)}`),
	aggregateKind: "session",
	aggregateId: sessionId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "TokenAppended",
	payload: {
		sessionId,
		messageId: assistantMessageId,
		token,
	},
});

const snapshotWithUser: RpcSessionSnapshot = {
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
	},
	messages: [
		{
			sessionId,
			sequence: 3,
			messageId: userMessageId,
			turnId: null,
			rowType: "user",
			content: { text: "Ping" },
		},
	],
	turns: [],
	activities: [],
	pendingApprovals: [],
};

const unusedProjectIndex = {
	projectPath: "/tmp/acepe",
	files: [],
	gitStatus: [],
	totalFiles: 0,
	totalLines: 0,
};

const fakeClient = (events: ReadonlyArray<OrchestrationEvent>): RpcClient => ({
	dispatch: () => Effect.succeed({ sequence: 1 }),
	snapshot: () => Effect.succeed(snapshotWithUser),
	getProjectIndex: () => Effect.succeed(unusedProjectIndex),
	invalidateProjectIndex: () => Effect.void,
	events: (fromSequence) =>
		Stream.fromArray(events.filter((event) => event.sequence > fromSequence)),
});

describe("createSessionStore", () => {
	it("starts from an empty snapshot", () => {
		const registry = AtomRegistry.make();
		const store = createSessionStore({
			client: fakeClient([]),
			registry,
		});
		expect(store.snapshot.current).toEqual(emptyRpcSessionSnapshot(0));
	});

	it("hydrates from snapshot then folds live tokens in sequence", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const registry = AtomRegistry.make();
				const store = createSessionStore({
					client: fakeClient(
						TRACER_REPLY_TOKENS.map((token, index) => tokenAt(4 + index, token)),
					),
					registry,
				});
				yield* store.openSession(sessionId);
				expect(store.snapshot.current.messages.map((row) => row.rowType)).toEqual([
					"user",
					"assistant",
				]);
				const user = store.snapshot.current.messages[0];
				const assistant = store.snapshot.current.messages[1];
				expect(user?.rowType).toBe("user");
				expect(assistant?.rowType).toBe("assistant");
				if (user?.rowType === "user") {
					expect(user.content.text).toBe("Ping");
				}
				if (assistant?.rowType === "assistant") {
					expect(assistant.content.text).toBe(TRACER_REPLY_TEXT);
					expect(assistant.sequence).toBe(4);
				}
			}),
		));

	it("discards replayed events at or below snapshotSequence", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const registry = AtomRegistry.make();
				const store = createSessionStore({
					client: fakeClient([sessionCreated, messageSent, tokenAt(4, "Hello")]),
					registry,
				});
				yield* store.openSession(sessionId);
				expect(store.snapshot.current.messages).toHaveLength(2);
				expect(store.snapshot.current.messages[0]?.messageId).toBe(userMessageId);
			}),
		));
});
