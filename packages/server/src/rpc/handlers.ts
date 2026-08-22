import {
	AcepeRpc,
	decodeRpcSessionSnapshot,
	FileGitStatus,
	type OrchestrationEvent,
	type RpcProjectedProject,
	RpcCommandInvariantError,
	RpcCommandPreviouslyRejectedError,
	RpcEngineShutdownError,
	RpcFileIndexNotADirectoryError,
	RpcFileIndexRootNotFoundError,
	RpcProjectorDecodeError,
	RpcSchemaError,
	type RpcServerError,
	type RpcSessionSnapshot,
	RpcSqlError,
	type Sequence,
	type SnapshotRequest,
	snapshotScope
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { SqlError } from "effect/unstable/sql/SqlError"
import { OrchestrationCommandPreviouslyRejectedError } from "../persistence/Services/OrchestrationCommandReceipts.ts"
import { OrchestrationEventStore } from "../persistence/Services/OrchestrationEventStore.ts"
import { OrchestrationCommandInvariantError } from "../orchestration/Errors.ts"
import { OrchestrationProjectorDecodeError } from "../orchestration/Schemas.ts"
import { FileIndexNotADirectoryError, FileIndexRootNotFoundError } from "../fileIndex/Errors.ts"
import { type FileIndexError, FileIndexService } from "../fileIndex/Services/FileIndexService.ts"
import { GitService, type GitServiceShape } from "../git/Services/GitService.ts"
import {
	type OrchestrationDispatchError,
	type OrchestrationEngineShape,
	OrchestrationEngine,
	OrchestrationEngineShutdownError
} from "../orchestration/Services/OrchestrationEngine.ts"
import {
	type SessionProjectionSnapshot,
	ProjectionSnapshotQuery
} from "../orchestration/Services/ProjectionSnapshotQuery.ts"

const EVENT_PAGE_SIZE = 1_000

export const toRpcProject = (project: SessionProjectionSnapshot["projects"][number]) => ({
	projectId: project.projectId,
	title: project.title,
	workspaceRoot: project.workspaceRoot,
	createdAt: project.createdAt,
	updatedAt: project.updatedAt,
	deletedAt: project.deletedAt,
	sessionCount: project.sessionCount,
	gitStatus: null
})

export const toRpcCheckpoint = (checkpoint: SessionProjectionSnapshot["checkpoints"][number]) => ({
	checkpointId: checkpoint.checkpointId,
	sessionId: checkpoint.sessionId,
	sequence: checkpoint.sequence,
	checkpointNumber: checkpoint.checkpointNumber,
	name: checkpoint.name,
	isAuto: checkpoint.isAuto,
	toolCallId: checkpoint.toolCallId,
	fileCount: checkpoint.fileCount,
	status: checkpoint.status,
	createdAt: checkpoint.createdAt,
	lastRevertedAt: checkpoint.lastRevertedAt
})

export const toRpcSnapshot = (snapshot: SessionProjectionSnapshot): RpcSessionSnapshot => ({
	snapshotSequence: snapshot.snapshotSequence,
	session: snapshot.session,
	messages: snapshot.messages,
	turns: snapshot.turns,
	activities: snapshot.activities,
	pendingApprovals: snapshot.pendingApprovals,
	checkpoints: Arr.map(snapshot.checkpoints, toRpcCheckpoint),
	projects: Arr.map(snapshot.projects, toRpcProject),
	sessions: snapshot.sessions,
	settings: snapshot.settings
})

const decodeRpcFileGitStatuses = Schema.decodeUnknownEffect(Schema.Array(FileGitStatus))

const liveProjectGitStatus = Effect.fn("liveProjectGitStatus")(function*(
	git: GitServiceShape,
	workspaceRoot: string
) {
	return yield* git.projectGitStatus(workspaceRoot).pipe(
		Effect.flatMap((rows) => decodeRpcFileGitStatuses(rows)),
		// Do not collapse a failure into an empty list: the UI cannot tell
		// "clean tree" from "git is broken". Log the cause and return null so
		// the snapshot still succeeds while the failure stays visible.
		Effect.tapCause((cause) => Effect.logWarning(`project git status unavailable: ${Cause.pretty(cause)}`)),
		Effect.orElseSucceed(() => null)
	)
})

const fillRpcProjectGitStatus = Effect.fn("fillRpcProjectGitStatus")(function*(
	git: GitServiceShape,
	project: RpcProjectedProject
) {
	const gitStatus = yield* liveProjectGitStatus(git, project.workspaceRoot)
	return {
		projectId: project.projectId,
		title: project.title,
		workspaceRoot: project.workspaceRoot,
		createdAt: project.createdAt,
		updatedAt: project.updatedAt,
		deletedAt: project.deletedAt,
		sessionCount: project.sessionCount,
		gitStatus
	} satisfies RpcProjectedProject
})

const withProjectGitStatus = Effect.fn("withProjectGitStatus")(function*(
	git: GitServiceShape,
	snapshot: RpcSessionSnapshot,
	request: SnapshotRequest
) {
	const scope = snapshotScope(request)
	if (scope.kind !== "project") {
		return snapshot
	}
	const projects = yield* Effect.forEach(snapshot.projects, (project) => {
		if (project.projectId !== scope.projectId) {
			return Effect.succeed(project)
		}
		return fillRpcProjectGitStatus(git, project)
	})
	return {
		snapshotSequence: snapshot.snapshotSequence,
		session: snapshot.session,
		messages: snapshot.messages,
		turns: snapshot.turns,
		activities: snapshot.activities,
		pendingApprovals: snapshot.pendingApprovals,
		checkpoints: snapshot.checkpoints,
		projects,
		sessions: snapshot.sessions,
		settings: snapshot.settings
	} satisfies RpcSessionSnapshot
})

export const rpcSnapshotForRequest = Effect.fn("rpcSnapshotForRequest")(function*(
	request: SnapshotRequest
) {
	const snapshots = yield* ProjectionSnapshotQuery
	const git = yield* GitService
	const snap = yield* snapshots.forRequest(request)
	return yield* withProjectGitStatus(git, toRpcSnapshot(snap), request)
})

export const toRpcError = (
	error: OrchestrationDispatchError | Schema.SchemaError | SqlError
): RpcServerError => {
	if (Schema.is(OrchestrationCommandInvariantError)(error)) {
		return new RpcCommandInvariantError({
			commandType: error.commandType,
			detail: error.detail
		})
	}
	if (Schema.is(OrchestrationCommandPreviouslyRejectedError)(error)) {
		return new RpcCommandPreviouslyRejectedError({
			commandId: error.commandId,
			reason: error.reason
		})
	}
	if (Schema.is(OrchestrationProjectorDecodeError)(error)) {
		return new RpcProjectorDecodeError({
			eventType: error.eventType,
			field: error.field,
			issue: error.issue
		})
	}
	if (Schema.is(OrchestrationEngineShutdownError)(error)) {
		return new RpcEngineShutdownError({})
	}
	if (Schema.is(SqlError)(error)) {
		return new RpcSqlError({ reason: error.message })
	}
	return new RpcSchemaError({ issue: error.message })
}

export const toFileIndexRpcError = (error: FileIndexError): RpcServerError => {
	if (Schema.is(FileIndexRootNotFoundError)(error)) {
		return new RpcFileIndexRootNotFoundError({ path: error.path })
	}
	if (Schema.is(FileIndexNotADirectoryError)(error)) {
		return new RpcFileIndexNotADirectoryError({ path: error.path })
	}
	return new RpcSchemaError({ issue: error.message })
}

type EventStoreShape = {
	readonly readFrom: (
		sequence: Sequence,
		limit: number
	) => Stream.Stream<OrchestrationEvent, SqlError | Schema.SchemaError>
}

const readAllFrom = Effect.fn("readAllFrom")(function*(
	store: EventStoreShape,
	fromSequence: Sequence
) {
	let cursor = fromSequence
	let acc: ReadonlyArray<OrchestrationEvent> = Arr.empty()
	while (true) {
		const page = yield* Stream.runCollect(store.readFrom(cursor, EVENT_PAGE_SIZE))
		if (!Arr.isReadonlyArrayNonEmpty(page)) {
			return acc
		}
		acc = Arr.appendAll(acc, page)
		cursor = Arr.lastNonEmpty(page).sequence
		if (page.length < EVENT_PAGE_SIZE) {
			return acc
		}
	}
})

export const eventsFromSequence = (
	store: EventStoreShape,
	engine: OrchestrationEngineShape,
	fromSequence: Sequence
) =>
	Stream.unwrap(
		Effect.gen(function*() {
			const liveQueue = yield* Queue.unbounded<OrchestrationEvent, Cause.Done>()
			yield* engine.streamDomainEvents.pipe(
				Stream.runForEach((event) => Queue.offer(liveQueue, event).pipe(Effect.asVoid)),
				Effect.ensuring(Queue.end(liveQueue).pipe(Effect.asVoid)),
				Effect.forkScoped({ startImmediately: true })
			)
			const replayed = yield* readAllFrom(store, fromSequence).pipe(Effect.mapError(toRpcError))
			const last = Option.match(Arr.last(replayed), {
				onNone: () => fromSequence,
				onSome: (event) => event.sequence
			})
			return Stream.concat(
				Stream.fromArray(replayed),
				Stream.fromQueue(liveQueue).pipe(Stream.filter((event) => event.sequence > last))
			)
		})
	)

export const RpcHandlersLive = AcepeRpc.toLayer(
	Effect.gen(function*() {
		const engine = yield* OrchestrationEngine
		const store = yield* OrchestrationEventStore
		const fileIndex = yield* FileIndexService
		return {
			dispatch: (command) => engine.dispatch(command).pipe(Effect.mapError(toRpcError)),
			snapshot: (request) =>
				rpcSnapshotForRequest(request).pipe(
					Effect.flatMap(decodeRpcSessionSnapshot),
					Effect.mapError(toRpcError)
				),
			events: (request) => eventsFromSequence(store, engine, request.fromSequence),
			getProjectIndex: (request) =>
				fileIndex.getProjectIndex(request.projectPath).pipe(Effect.mapError(toFileIndexRpcError)),
			invalidateProjectIndex: (request) => fileIndex.invalidate(request.projectPath)
		}
	})
)
