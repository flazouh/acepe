import { describe, expect, it } from "bun:test"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as FastCheck from "effect/testing/FastCheck"

import { OrchestrationEvent } from "./events.ts"
import { CommandId, EventId, ProjectId, SessionId } from "./ids.ts"
import { OrchestrationCommand, ProjectCreateCommand } from "./orchestration.ts"
import {
	AcepeRpc,
	decodeDispatchExit,
	decodeGetProjectIndexExit,
	decodeOrchestrationEvent,
	decodeSnapshotExit,
	decodeSnapshotRequest,
	encodeDispatchExit,
	encodeGetProjectIndexExit,
	encodeOrchestrationEvent,
	encodeSnapshotExit,
	exitToEffect,
	generateElectrobunRpcSchema,
	librarySnapshotRequest,
	makeResumingRpcClient,
	projectSnapshotRequest,
	RPC_PRIMITIVE_TAGS,
	RpcCommandInvariantError,
	RpcDispatchResult,
	RpcSessionSnapshot,
	RpcTransportError,
	sessionSnapshotRequest,
	settingsSnapshotRequest,
	skillsSnapshotRequest,
	snapshotScope,
	type RpcTransport,
} from "./rpc.ts"

const groupTags = Arr.fromIterable(AcepeRpc.requests.keys()).sort()
const primitiveTags = Arr.fromIterable(RPC_PRIMITIVE_TAGS).sort()

const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")

const createProject = ProjectCreateCommand.make({
	type: "project.create",
	commandId,
	projectId,
	title: "Acepe",
	workspaceRoot: "/tmp/acepe",
})

const eventAt = (sequence: number): OrchestrationEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "project",
	aggregateId: projectId,
	occurredAt: "2026-08-20T12:00:00.000Z",
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "ProjectCreated",
	payload: {
		projectId,
		title: "Acepe",
		workspaceRoot: "/tmp/acepe",
	},
})

const emptySnapshot: RpcSessionSnapshot = {
	snapshotSequence: 0,
	session: null,
	messages: [],
	turns: [],
	activities: [],
	pendingApprovals: [],
	projects: [],
	sessions: [],
	settings: [],
	skillsCatalog: null,
}

const snapshot: RpcSessionSnapshot = {
	snapshotSequence: 4,
	session: {
		sessionId,
		projectId,
		title: "Ship the slice",
		provider: null,
		createdAt: "2026-08-20T12:00:00.000Z",
		updatedAt: "2026-08-20T12:00:00.000Z",
		lastActivityAt: "2026-08-20T12:00:00.000Z",
		archivedAt: null,
		deletedAt: null,
		prNumber: null,
		prLinkMode: null,
	},
	messages: [
		{
			sessionId,
			sequence: 2,
			messageId: "message-2",
			turnId: null,
			rowType: "user",
			content: {
				text: "Ship the slice",
			},
		},
	],
	turns: [],
	activities: [],
	pendingApprovals: [],
	projects: [
		{
			projectId,
			title: "Acepe",
			workspaceRoot: "/tmp/acepe",
			createdAt: "2026-08-20T12:00:00.000Z",
			updatedAt: "2026-08-20T12:00:00.000Z",
			deletedAt: null,
			sessionCount: 1,
			gitStatus: [],
		},
	],
	sessions: [
		{
			sessionId,
			projectId,
			title: "Ship the slice",
			provider: null,
			createdAt: "2026-08-20T12:00:00.000Z",
			updatedAt: "2026-08-20T12:00:00.000Z",
			lastActivityAt: "2026-08-20T12:00:00.000Z",
			archivedAt: null,
			deletedAt: null,
			prNumber: null,
			prLinkMode: null,
		},
	],
	settings: [],
	skillsCatalog: null,
}

const unusedDispatch: RpcTransport["dispatch"] = (_command) => Effect.succeed({ sequence: 0 })
const unusedSnapshot: RpcTransport["snapshot"] = (_request) => Effect.succeed(emptySnapshot)
const unusedGetProjectIndex: RpcTransport["getProjectIndex"] = (_projectPath) =>
	Effect.succeed({
		projectPath: "/tmp/acepe",
		files: [],
		gitStatus: [],
		totalFiles: 0,
		totalLines: 0,
	})
const unusedInvalidateProjectIndex: RpcTransport["invalidateProjectIndex"] = (_projectPath) =>
	Effect.void

describe("AcepeRpc primitives", () => {
	it("exposes dispatch, snapshot, events, and file index", () => {
		expect(groupTags).toEqual(primitiveTags)
		expect(groupTags).toEqual([
			"dispatch",
			"events",
			"getProjectIndex",
			"invalidateProjectIndex",
			"snapshot",
		])
	})
})

describe("generateElectrobunRpcSchema", () => {
	it("derives bun request keys from the contract group", () => {
		const schema = generateElectrobunRpcSchema()
		expect(Object.keys(schema.bun.requests).sort()).toEqual(groupTags)
		expect(Object.keys(schema.bun.messages)).toEqual([])
		expect(Object.keys(schema.webview.requests)).toEqual([])
		expect(Object.keys(schema.webview.messages)).toEqual(["events"])
	})
})

describe("Schema-encoded boundary", () => {
	it("round-trips dispatch success through Exit", () => {
		const encoded = Exit.succeed(RpcDispatchResult.make({ sequence: 3 })).pipe(
			encodeDispatchExit,
			Effect.runSync,
		)
		const decoded = decodeDispatchExit(encoded).pipe(Effect.runSync)
		expect(Exit.isSuccess(decoded)).toBe(true)
		if (Exit.isSuccess(decoded)) {
			expect(decoded.value.sequence).toBe(3)
		}
	})

	it("preserves TaggedError tag across the Exit encoding", () => {
		const error = new RpcCommandInvariantError({
			commandType: "session.create",
			detail: "Project does not exist.",
		})
		const encoded = Exit.fail(error).pipe(encodeDispatchExit, Effect.runSync)
		const decoded = decodeDispatchExit(encoded).pipe(Effect.runSync)
		const recovered = decoded.pipe(exitToEffect, Effect.flip, Effect.runSync)
		expect(recovered._tag).toBe("OrchestrationCommandInvariantError")
		if (recovered._tag === "OrchestrationCommandInvariantError") {
			expect(recovered.commandType).toBe("session.create")
			expect(recovered.detail).toBe("Project does not exist.")
		}
	})

	it("round-trips orchestration commands as dispatch payload", () => {
		const encoded = Effect.runSync(Schema.encodeUnknownEffect(OrchestrationCommand)(createProject))
		const decoded = Effect.runSync(Schema.decodeUnknownEffect(OrchestrationCommand)(encoded))
		expect(decoded).toEqual(createProject)
	})

	it("round-trips a project index through Exit", () => {
		const encoded = Exit.succeed({
			projectPath: "/tmp/acepe",
			files: [],
			gitStatus: [],
			totalFiles: 0,
			totalLines: 0,
		}).pipe(encodeGetProjectIndexExit, Effect.runSync)
		const decoded = decodeGetProjectIndexExit(encoded).pipe(Effect.runSync)
		expect(Exit.isSuccess(decoded)).toBe(true)
		if (Exit.isSuccess(decoded)) {
			expect(decoded.value.projectPath).toBe("/tmp/acepe")
			expect(decoded.value.totalFiles).toBe(0)
		}
	})

	it("round-trips a session snapshot", () => {
		const encoded = Effect.runSync(Schema.encodeUnknownEffect(RpcSessionSnapshot)(snapshot))
		const decoded = Effect.runSync(Schema.decodeUnknownEffect(RpcSessionSnapshot)(encoded))
		expect(decoded.snapshotSequence).toBe(4)
		expect(decoded.session?.sessionId).toBe(sessionId)
		expect(decoded.messages[0]?.rowType).toBe("user")
		expect(decoded.projects[0]?.title).toBe("Acepe")
		expect(decoded.sessions[0]?.title).toBe("Ship the slice")
		expect(decoded.settings).toEqual([])
	})

	it("round-trips git status on a projected project", () => {
		const withGit: RpcSessionSnapshot = {
			snapshotSequence: 4,
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
					createdAt: "2026-08-20T12:00:00.000Z",
					updatedAt: "2026-08-20T12:00:00.000Z",
					deletedAt: null,
					sessionCount: 1,
					gitStatus: [
						{
							path: "src/main.ts",
							status: "M",
							insertions: 4,
							deletions: 1,
						},
					],
				},
			],
			sessions: [],
			settings: [],
			skillsCatalog: null,
		}
		const encoded = Effect.runSync(Schema.encodeUnknownEffect(RpcSessionSnapshot)(withGit))
		const decoded = Effect.runSync(Schema.decodeUnknownEffect(RpcSessionSnapshot)(encoded))
		expect(decoded.projects[0]?.gitStatus).toEqual([
			{
				path: "src/main.ts",
				status: "M",
				insertions: 4,
				deletions: 1,
			},
		])
	})

	it("round-trips a library snapshot Exit across JSON IPC", () => {
		const encoded = Exit.succeed(snapshot).pipe(encodeSnapshotExit, Effect.runSync)
		const decoded = decodeSnapshotExit(JSON.parse(JSON.stringify(encoded))).pipe(Effect.runSync)
		expect(Exit.isSuccess(decoded)).toBe(true)
		if (Exit.isSuccess(decoded)) {
			expect(decoded.value.projects[0]?.title).toBe("Acepe")
			expect(decoded.value.sessions[0]?.title).toBe("Ship the slice")
		}
	})

	it("decodes library, settings, skills, project, session, and legacy snapshot requests", () => {
		expect(Effect.runSync(decodeSnapshotRequest({ kind: "library" }))).toEqual(
			librarySnapshotRequest(),
		)
		expect(Effect.runSync(decodeSnapshotRequest({ kind: "settings" }))).toEqual(
			settingsSnapshotRequest(),
		)
		expect(Effect.runSync(decodeSnapshotRequest({ kind: "skills" }))).toEqual(
			skillsSnapshotRequest(),
		)
		expect(
			Effect.runSync(decodeSnapshotRequest({ kind: "project", projectId })),
		).toEqual(projectSnapshotRequest(projectId))
		expect(
			Effect.runSync(decodeSnapshotRequest({ kind: "session", sessionId })),
		).toEqual(sessionSnapshotRequest(sessionId))
		expect(Effect.runSync(decodeSnapshotRequest({ sessionId }))).toEqual({ sessionId })
	})

	it("maps snapshot requests onto library, settings, skills, project, or session scope", () => {
		expect(snapshotScope(librarySnapshotRequest())).toEqual({ kind: "library" })
		expect(snapshotScope(settingsSnapshotRequest())).toEqual({ kind: "settings" })
		expect(snapshotScope(skillsSnapshotRequest())).toEqual({ kind: "skills" })
		expect(snapshotScope(projectSnapshotRequest(projectId))).toEqual({
			kind: "project",
			projectId,
		})
		expect(snapshotScope(sessionSnapshotRequest(sessionId))).toEqual({
			kind: "session",
			sessionId,
		})
		expect(snapshotScope({ sessionId })).toEqual({ kind: "session", sessionId })
	})

	it("round-trips generated events", () => {
		const arbitrary = Schema.toArbitrary(OrchestrationEvent)(FastCheck)
		FastCheck.assert(
			FastCheck.property(arbitrary, (event) => {
				const encoded = Effect.runSync(encodeOrchestrationEvent(event))
				const decoded = Effect.runSync(decodeOrchestrationEvent(encoded))
				expect(decoded.sequence).toBe(event.sequence)
				expect(decoded.type).toBe(event.type)
			}),
			{ numRuns: 25, seed: 1 },
		)
	})
})

const failingAfter = (
	values: ReadonlyArray<OrchestrationEvent>,
	failOn: number,
	calls: Ref.Ref<number>,
): RpcTransport => ({
	dispatch: unusedDispatch,
	snapshot: unusedSnapshot,
	getProjectIndex: unusedGetProjectIndex,
	invalidateProjectIndex: unusedInvalidateProjectIndex,
	events: (fromSequence) =>
		Stream.unwrap(
			Ref.updateAndGet(calls, (count) => count + 1).pipe(
				Effect.map((attempt) => {
					const remaining = Arr.filter(values, (event) => event.sequence > fromSequence)
					if (attempt === failOn) {
						return Stream.fromArray(Arr.take(remaining, 2)).pipe(
							Stream.concat(
								Stream.fail(new RpcTransportError({ reason: "bun process killed" })),
							),
						)
					}
					return Stream.fromArray(remaining)
				}),
			),
		),
})

describe("makeResumingRpcClient", () => {
	it("resumes events from the last seen sequence with no gap and no duplicate", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const calls = yield* Ref.make(0)
				const source = [eventAt(1), eventAt(2), eventAt(3), eventAt(4), eventAt(5)]
				const client = makeResumingRpcClient(failingAfter(source, 1, calls))
				const events = yield* Stream.runCollect(client.events(0).pipe(Stream.take(5)))
				const sequences = events.map((event) => event.sequence)
				const attempts = yield* Ref.get(calls)
				expect(sequences).toEqual([1, 2, 3, 4, 5])
				expect(attempts).toBeGreaterThan(1)
			}),
		))

	it("skips duplicates if a resume overlaps the last seen sequence", () =>
		makeResumingRpcClient({
			dispatch: unusedDispatch,
			snapshot: unusedSnapshot,
			getProjectIndex: unusedGetProjectIndex,
			invalidateProjectIndex: unusedInvalidateProjectIndex,
			events: (_fromSequence) =>
				Stream.fromArray([eventAt(1), eventAt(2), eventAt(2), eventAt(3)]),
		})
			.events(0)
			.pipe(
				Stream.take(3),
				Stream.runCollect,
				Effect.map((events) => {
					expect(events.map((event) => event.sequence)).toEqual([1, 2, 3])
				}),
				Effect.runPromise,
			))

	it("fails on a sequence gap instead of reconnecting", () =>
		makeResumingRpcClient({
			dispatch: unusedDispatch,
			snapshot: unusedSnapshot,
			getProjectIndex: unusedGetProjectIndex,
			invalidateProjectIndex: unusedInvalidateProjectIndex,
			events: (_fromSequence) => Stream.fromArray([eventAt(1), eventAt(3)]),
		})
			.events(0)
			.pipe(
				Stream.runCollect,
				Effect.flip,
				Effect.map((error) => {
					expect(error._tag).toBe("RpcEventSequenceGapError")
				}),
				Effect.runPromise,
			))
})
