import { describe, expect, it } from "bun:test";
import {
	CommandId,
	EventId,
	emptyRpcSessionSnapshot,
	MessageId,
	type OrchestrationCommand,
	type OrchestrationEvent,
	ProjectId,
	type RpcClient,
	type RpcDispatchResult,
	type RpcSessionSnapshot,
	SessionId,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { composeSessionStore } from "./session-store-compose.ts";

const commandId = CommandId.make("cmd-1");
const projectId = ProjectId.make("project-1");
const sessionId = SessionId.make("session-1");
const userMessageId = MessageId.make("message-user");
const occurredAt = "2026-08-20T12:00:00.000Z";

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
		prNumber: null,
		prLinkMode: null,
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
	projects: [],
	sessions: [],
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
		messageId: MessageId.make("message-assistant"),
		token,
	},
});

const metaUpdated = (sequence: number): OrchestrationEvent => ({
	sequence,
	eventId: EventId.make(`event-${String(sequence)}`),
	aggregateKind: "session",
	aggregateId: sessionId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "SessionMetaUpdated",
	payload: {
		sessionId,
		prNumber: 42,
		prLinkMode: "manual",
	},
});

const clientOf = (input: {
	readonly snapshot: RpcSessionSnapshot;
	readonly events: ReadonlyArray<OrchestrationEvent>;
	readonly dispatch?: (command: OrchestrationCommand) => Effect.Effect<RpcDispatchResult>;
}): RpcClient => ({
	dispatch: input.dispatch ?? (() => Effect.succeed({ sequence: 1 })),
	snapshot: () => Effect.succeed(input.snapshot),
	getProjectIndex: () =>
		Effect.succeed({ projectPath: "/tmp/p", totalFiles: 0, files: [], scannedAt: 0 }) as never,
	invalidateProjectIndex: () => Effect.void,
	events: () => Stream.fromArray(input.events),
});

describe("composeSessionStore", () => {
	it("holds only the empty snapshot before open", () => {
		const registry = AtomRegistry.make();
		const store = composeSessionStore({
			client: clientOf({ snapshot: snapshotWithUser, events: [] }),
			registry,
		});
		expect(registry.get(store.snapshotAtom)).toEqual(emptyRpcSessionSnapshot(0));
		expect(registry.get(store.sendMomentAtom)).toBeNull();
	});

	it("discards live events at or below snapshotSequence", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const registry = AtomRegistry.make();
				const store = composeSessionStore({
					client: clientOf({
						snapshot: snapshotWithUser,
						events: [tokenAt(3, "WRONG"), tokenAt(4, "Hello")],
					}),
					registry,
				});
				yield* store.openSession(sessionId);
				const snapshot = registry.get(store.snapshotAtom);
				expect(snapshot.messages).toHaveLength(2);
				const assistant = snapshot.messages[1];
				expect(assistant?.rowType).toBe("assistant");
				if (assistant?.rowType === "assistant") {
					expect(assistant.content.text).toBe("Hello");
				}
			})
		));

	it("computes send-moment header and spark without writing session title", () => {
		const registry = AtomRegistry.make();
		const store = composeSessionStore({
			client: clientOf({ snapshot: emptyRpcSessionSnapshot(0), events: [] }),
			registry,
		});
		store.recordSendMoment({
			text: "Reply with only the word hello",
			selectedAgentId: "claude-code",
			projectName: "acepe",
		});
		expect(registry.get(store.snapshotAtom).session).toBeNull();
		expect(store.headerTitle()).toBe("Reply with only the word hello");
		expect(store.showWorkingSpark()).toBe(true);
	});

	it("dispatches the PR link toggle through session.meta.update", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: Array<OrchestrationCommand> = [];
				const registry = AtomRegistry.make();
				const store = composeSessionStore({
					client: clientOf({
						snapshot: snapshotWithUser,
						events: [],
						dispatch: (command) => {
							dispatched.push(command);
							return Effect.succeed({ sequence: 4 });
						},
					}),
					registry,
				});
				yield* store.openSession(sessionId);
				const result = yield* store.togglePrLink({
					commandId: CommandId.make("cmd-pr"),
					sessionId,
					prNumber: 42,
					prLinkMode: "manual",
				});
				expect(result).toEqual({ sequence: 4 });
				expect(dispatched).toEqual([
					{
						type: "session.meta.update",
						commandId: CommandId.make("cmd-pr"),
						sessionId,
						prNumber: 42,
						prLinkMode: "manual",
					},
				]);
			})
		));

	it("folds a live SessionMetaUpdated onto the snapshot", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const registry = AtomRegistry.make();
				const store = composeSessionStore({
					client: clientOf({
						snapshot: snapshotWithUser,
						events: [metaUpdated(4)],
					}),
					registry,
				});
				yield* store.openSession(sessionId);
				expect(registry.get(store.snapshotAtom).session?.prNumber).toBe(42);
				expect(registry.get(store.snapshotAtom).session?.prLinkMode).toBe("manual");
			})
		));

	it("keeps the send-moment header when the snapshot still has a fallback title", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const registry = AtomRegistry.make();
				const deferred: RpcSessionSnapshot = {
					snapshotSequence: 1,
					session: {
						sessionId,
						projectId,
						title: "New Thread",
						provider: null,
						createdAt: occurredAt,
						updatedAt: occurredAt,
						lastActivityAt: occurredAt,
						archivedAt: null,
						deletedAt: null,
						prNumber: null,
						prLinkMode: null,
					},
					messages: snapshotWithUser.messages,
					turns: snapshotWithUser.turns,
					activities: snapshotWithUser.activities,
					pendingApprovals: snapshotWithUser.pendingApprovals,
					projects: snapshotWithUser.projects,
					sessions: snapshotWithUser.sessions,
				};
				const store = composeSessionStore({
					client: clientOf({ snapshot: deferred, events: [] }),
					registry,
				});
				store.recordSendMoment({
					text: "Reply with only the word hello",
					selectedAgentId: "claude-code",
					projectName: "acepe",
				});
				yield* store.openSession(sessionId);
				expect(store.headerTitle()).toBe("Reply with only the word hello");
				expect(store.showWorkingSpark()).toBe(true);
			})
		));

	it("skips automatic PR updates while manual mode is on the snapshot", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: Array<string> = [];
				const registry = AtomRegistry.make();
				const linked: RpcSessionSnapshot = {
					snapshotSequence: 4,
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
						prNumber: 17,
						prLinkMode: "manual",
					},
					messages: snapshotWithUser.messages,
					turns: snapshotWithUser.turns,
					activities: snapshotWithUser.activities,
					pendingApprovals: snapshotWithUser.pendingApprovals,
					projects: snapshotWithUser.projects,
					sessions: snapshotWithUser.sessions,
				};
				const store = composeSessionStore({
					client: clientOf({
						snapshot: linked,
						events: [],
						dispatch: (command) => {
							dispatched.push(command.type);
							return Effect.succeed({ sequence: 5 });
						},
					}),
					registry,
				});
				yield* store.openSession(sessionId);
				const result = yield* store.togglePrLink({
					commandId: CommandId.make("cmd-pr"),
					sessionId,
					prNumber: 99,
					prLinkMode: "automatic",
				});
				expect(dispatched).toEqual([]);
				expect(result).toEqual({ sequence: 4 });
			})
		));
});

it("openLibrary reads projects without opening a session", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const registry = AtomRegistry.make();
			const parts = composeSessionStore({
				client: clientOf({
					snapshot: {
						...snapshotWithUser,
						session: null,
						projects: [
							{
								projectId,
								title: "Acepe",
								workspaceRoot: "/Users/alex/Documents/acepe",
								createdAt: "2026-08-22T00:00:00.000Z",
								updatedAt: "2026-08-22T00:00:00.000Z",
								deletedAt: null,
								sessionCount: 3,
								gitStatus: null,
							},
						],
					},
					events: [],
				}),
				registry,
			});
			const snap = yield* parts.openLibrary();
			expect(snap.projects.length).toBe(1);
			expect(snap.projects[0]?.title).toBe("Acepe");
			expect(snap.session).toBe(null);
		}),
	));

it("openProject lists that project's sessions without opening one", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const registry = AtomRegistry.make();
			const parts = composeSessionStore({
				client: clientOf({
					snapshot: {
						...snapshotWithUser,
						session: null,
						sessions: [
							{ ...snapshotWithUser.session!, title: "First session" },
							{ ...snapshotWithUser.session!, title: "Archived one" },
						],
					},
					events: [],
				}),
				registry,
			});
			const snap = yield* parts.openProject(projectId);
			expect(snap.sessions.length).toBe(2);
			expect(snap.sessions[0]?.title).toBe("First session");
			expect(snap.session).toBe(null);
		}),
	));
