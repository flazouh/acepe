import { describe, expect, it } from "bun:test";
import {
	CommandId,
	EventId,
	encodeDispatchExit,
	encodeGetProjectIndexExit,
	encodeOrchestrationEvent,
	encodeSnapshotExit,
	ProjectCreateCommand,
	ProjectId,
	RpcCommandInvariantError,
	SessionId,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Stream from "effect/Stream";

import { type ElectrobunRpcBridge, makeElectrobunRpcTransport } from "./client.js";

const commandId = CommandId.make("cmd-1");
const projectId = ProjectId.make("project-1");
const sessionId = SessionId.make("session-1");

const createProject = ProjectCreateCommand.make({
	type: "project.create",
	commandId,
	projectId,
	title: "Acepe",
	workspaceRoot: "/tmp/acepe",
});

const projectCreated = {
	sequence: 1,
	eventId: EventId.make("event-1"),
	aggregateKind: "project" as const,
	aggregateId: projectId,
	occurredAt: "2026-08-20T12:00:00.000Z",
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "ProjectCreated" as const,
	payload: {
		projectId,
		title: "Acepe",
		workspaceRoot: "/tmp/acepe",
	},
};

const emptySnapshot = {
	snapshotSequence: 0,
	session: null,
	messages: [],
	turns: [],
	activities: [],
	pendingApprovals: [],
};

const makeBridge = (input: {
	readonly dispatch?: (params: unknown) => Promise<unknown>;
	readonly snapshot?: (params: unknown) => Promise<unknown>;
	readonly events?: (params: unknown) => Promise<unknown>;
	readonly getProjectIndex?: (params: unknown) => Promise<unknown>;
	readonly invalidateProjectIndex?: (params: unknown) => Promise<unknown>;
}): ElectrobunRpcBridge & { readonly emitEvents: (payload: unknown) => void } => {
	const listeners: Array<(payload: unknown) => void> = [];
	return {
		request: {
			dispatch: (params) =>
				input.dispatch === undefined
					? Promise.reject(new Error("unused dispatch"))
					: input.dispatch(params),
			snapshot: (params) =>
				input.snapshot === undefined
					? Promise.reject(new Error("unused snapshot"))
					: input.snapshot(params),
			events: (params) =>
				input.events === undefined ? Promise.resolve(undefined) : input.events(params),
			getProjectIndex: (params) =>
				input.getProjectIndex === undefined
					? Promise.reject(new Error("unused getProjectIndex"))
					: input.getProjectIndex(params),
			invalidateProjectIndex: (params) =>
				input.invalidateProjectIndex === undefined
					? Promise.reject(new Error("unused invalidateProjectIndex"))
					: input.invalidateProjectIndex(params),
		},
		addMessageListener: (_message, listener) => {
			listeners.push(listener);
		},
		removeMessageListener: (_message, listener) => {
			const index = listeners.indexOf(listener);
			if (index >= 0) {
				listeners.splice(index, 1);
			}
		},
		emitEvents: (payload) => {
			for (const listener of listeners) {
				listener(payload);
			}
		},
	};
};

describe("makeElectrobunRpcTransport", () => {
	it("decodes a dispatch success Exit from the bun side", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const encoded = yield* encodeDispatchExit(Exit.succeed({ sequence: 3 }));
				const bridge = makeBridge({
					dispatch: () => Promise.resolve(encoded),
				});
				const transport = makeElectrobunRpcTransport(bridge);
				const result = yield* transport.dispatch(createProject);
				expect(result.sequence).toBe(3);
			})
		));

	it("preserves TaggedError tag across the Electrobun Exit payload", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const error = new RpcCommandInvariantError({
					commandType: "session.create",
					detail: "Project does not exist.",
				});
				const encoded = yield* encodeDispatchExit(Exit.fail(error));
				const bridge = makeBridge({
					dispatch: () => Promise.resolve(encoded),
				});
				const transport = makeElectrobunRpcTransport(bridge);
				const recovered = yield* Effect.flip(transport.dispatch(createProject));
				expect(recovered._tag).toBe("OrchestrationCommandInvariantError");
			})
		));

	it("decodes a snapshot Exit", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const encoded = yield* encodeSnapshotExit(Exit.succeed(emptySnapshot));
				const bridge = makeBridge({
					snapshot: () => Promise.resolve(encoded),
				});
				const transport = makeElectrobunRpcTransport(bridge);
				const snapshot = yield* transport.snapshot(sessionId);
				expect(snapshot.session).toBe(null);
				expect(snapshot.snapshotSequence).toBe(0);
			})
		));

	it("decodes a getProjectIndex Exit", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const encoded = yield* encodeGetProjectIndexExit(
					Exit.succeed({
						projectPath: "/tmp/acepe",
						files: [],
						gitStatus: [],
						totalFiles: 0,
						totalLines: 0,
					})
				);
				const bridge = makeBridge({
					getProjectIndex: () => Promise.resolve(encoded),
				});
				const transport = makeElectrobunRpcTransport(bridge);
				const index = yield* transport.getProjectIndex("/tmp/acepe");
				expect(index.totalFiles).toBe(0);
				expect(index.projectPath).toBe("/tmp/acepe");
			})
		));

	it("subscribes to events and yields decoded webview messages", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const encodedEvent = yield* encodeOrchestrationEvent(projectCreated);
				const requested: Array<unknown> = [];
				const bridge = makeBridge({
					events: (params) => {
						requested.push(params);
						queueMicrotask(() => {
							bridge.emitEvents(encodedEvent);
						});
						return Promise.resolve(undefined);
					},
				});
				const transport = makeElectrobunRpcTransport(bridge);
				const events = yield* Stream.take(transport.events(0), 1).pipe(Stream.runCollect);
				expect(requested).toEqual([{ fromSequence: 0 }]);
				expect(events[0]?.type).toBe("ProjectCreated");
				expect(events[0]?.sequence).toBe(1);
			})
		));
});
