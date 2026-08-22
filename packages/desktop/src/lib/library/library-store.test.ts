import { describe, expect, it } from "bun:test";
import {
	CommandId,
	emptyRpcSessionSnapshot,
	EventId,
	librarySnapshotRequest,
	MessageId,
	ProjectId,
	type RpcClient,
	type RpcSessionSnapshot,
	SessionId,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { composeLibraryStore, isLibraryProjectionEvent } from "./library-store.ts";

const projectId = ProjectId.make("project-1");
const sessionId = SessionId.make("session-1");
const occurredAt = "2026-08-20T12:00:00.000Z";

const librarySnapshot: RpcSessionSnapshot = {
	snapshotSequence: 6,
	session: null,
	messages: [],
	turns: [],
	activities: [],
	pendingApprovals: [],
	projects: [
		{
			projectId,
			title: "Acepe",
			workspaceRoot: "/tmp/acepe",
			createdAt: occurredAt,
			updatedAt: occurredAt,
			deletedAt: null,
			sessionCount: 1,
			gitStatus: [],
		},
	],
	sessions: [
		{
			sessionId,
			projectId,
			title: "Fix the auth bug",
			provider: null,
			createdAt: occurredAt,
			updatedAt: occurredAt,
			lastActivityAt: occurredAt,
			archivedAt: null,
			deletedAt: null,
			prNumber: null,
			prLinkMode: null,
		},
	],
	settings: [],
};

describe("isLibraryProjectionEvent", () => {
	it("treats session archive as a library fact", () => {
		expect(
			isLibraryProjectionEvent({
				sequence: 2,
				eventId: EventId.make("event-2"),
				aggregateKind: "session",
				aggregateId: sessionId,
				occurredAt,
				commandId: CommandId.make("cmd-2"),
				causationEventId: null,
				correlationId: CommandId.make("cmd-2"),
				metadata: {},
				type: "SessionArchived",
				payload: {
					sessionId,
				},
			}),
		).toBe(true);
		expect(
			isLibraryProjectionEvent({
				sequence: 3,
				eventId: EventId.make("event-3"),
				aggregateKind: "session",
				aggregateId: sessionId,
				occurredAt,
				commandId: CommandId.make("cmd-3"),
				causationEventId: null,
				correlationId: CommandId.make("cmd-3"),
				metadata: {},
				type: "TokenAppended",
				payload: {
					sessionId,
					messageId: MessageId.make("message-1"),
					token: "x",
				},
			}),
		).toBe(false);
	});
});

describe("composeLibraryStore", () => {
	it("loads the library through snapshot, not a fourth RPC", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const requested: Array<unknown> = [];
				const client: RpcClient = {
					dispatch: () => Effect.succeed({ sequence: 1 }),
					snapshot: (request) => {
						requested.push(request);
						return Effect.succeed(librarySnapshot);
					},
					getProjectIndex: () =>
						Effect.succeed({
							projectPath: "/tmp/acepe",
							files: [],
							gitStatus: [],
							totalFiles: 0,
							totalLines: 0,
						}),
					invalidateProjectIndex: () => Effect.void,
					events: () => Stream.empty,
				};
				const registry = AtomRegistry.make();
				const seen: Array<string> = [];
				const store = composeLibraryStore({
					client,
					registry,
					onSnapshot: (snapshot) => {
						seen.push(snapshot.projects[0]?.title ?? "");
					},
				});
				expect(registry.get(store.snapshotAtom)).toEqual(emptyRpcSessionSnapshot(0));
				yield* store.openLibrary();
				expect(requested).toEqual([librarySnapshotRequest()]);
				expect(registry.get(store.snapshotAtom).projects[0]?.title).toBe("Acepe");
				expect(seen).toEqual(["Acepe"]);
				store.selectProject(projectId);
				expect(registry.get(store.selectedProjectIdAtom)).toBe(projectId);
			}),
		));
});

describe("openProject", () => {
	it("loads that project's sessions, not just its id", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const requested: Array<unknown> = [];
				const client: RpcClient = {
					dispatch: () => Effect.succeed({ sequence: 1 }),
					snapshot: (request) => {
						requested.push(request);
						return Effect.succeed({
							...librarySnapshot,
							sessions: [
								{ ...librarySnapshot.sessions[0]!, title: "First session" },
								{ ...librarySnapshot.sessions[0]!, title: "Second session" },
							],
						});
					},
					getProjectIndex: () =>
						Effect.succeed({
							projectPath: "/tmp/acepe",
							files: [],
							gitStatus: [],
							totalFiles: 0,
							totalLines: 0,
						}),
					invalidateProjectIndex: () => Effect.void,
					events: () => Stream.empty,
				};
				const registry = AtomRegistry.make();
				const store = composeLibraryStore({ client, registry });
				const snap = yield* store.openProject(projectId);
				expect(snap.sessions.length).toBe(2);
				expect(registry.get(store.selectedProjectIdAtom)).toBe(projectId);
			}),
		));
});
