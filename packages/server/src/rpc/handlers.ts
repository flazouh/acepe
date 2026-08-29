import {
	AcepeRpc,
	decodeRpcSessionSnapshot,
	decodeProjectId,
	decodeSessionId,
	FileGitStatus,
	type ImportProviderSessionRequest,
	type ListProviderSessionsRequest,
	type OrchestrationCommand,
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
	snapshotScope,
	type TrimmedNonEmptyString
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import type { PlatformError } from "effect/PlatformError"
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
import { getDefaultShell as getDefaultShellUtil } from "../fsUtil/readWriteText.ts"
import { GitService, type GitServiceShape } from "../git/Services/GitService.ts"
import { pathToSlug } from "../history/discovery/Roots.ts"
import {
	ProviderSessionDiscovery,
	type ProviderSessionDiscoveryShape
} from "../history/discovery/ProviderSessionDiscovery.ts"
import type { HistoryImportError, HistoryImporterShape } from "../history/importer.ts"
import { ClaudeHistory } from "../history/Services/ClaudeHistory.ts"
import type { HistoryDirectoryNotFoundError } from "../history/Errors.ts"
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
import {
	DEFAULT_SHOW_EXTERNAL_CLI_SESSIONS,
	ProjectionProjects,
	type ProjectionProjectsShape
} from "../persistence/Services/ProjectionProjects.ts"
import { fillAcpCommand } from "../acp/fillCommand.ts"
import { fillSkillsDiscoverCommand } from "../skills/discoverCatalog.ts"
import { fillGitCommand } from "../git/fillCommand.ts"
import { fillMcpCommand } from "../mcp/fillCommand.ts"
import { fillTerminalCommand } from "../terminal/fillCommand.ts"
import { fillVoiceCommand } from "../voice/fillCommand.ts"
import { fillCheckpointCommand } from "../checkpoint/fillCommand.ts"
import { CheckpointNotFoundError, CheckpointService } from "../checkpoint/Services/CheckpointService.ts"
import { routeGitCall } from "../git/gitCallHandler.ts"
import { routeAgentCall } from "../provider/agentCallHandler.ts"
import { ProviderUsageService } from "../providerUsage/Services/ProviderUsageService.ts"
import { guardedReadTextFile, guardedWriteTextFile } from "./fsPathGuard.ts"

const EVENT_PAGE_SIZE = 1_000

export const toRpcProject = (project: SessionProjectionSnapshot["projects"][number]) => ({
	projectId: project.projectId,
	title: project.title,
	workspaceRoot: project.workspaceRoot,
	createdAt: project.createdAt,
	updatedAt: project.updatedAt,
	deletedAt: project.deletedAt,
	sessionCount: project.sessionCount,
	color: project.color,
	showExternalCliSessions: project.showExternalCliSessions,
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
	lastRevertedAt: checkpoint.lastRevertedAt,
	files: Arr.empty()
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
	settings: snapshot.settings,
	skillsCatalog: snapshot.skillsCatalog,
	voice: snapshot.voice,
	gitReview: snapshot.gitReview,
	mcpCatalog: snapshot.mcpCatalog,
	preconnectionOptions: snapshot.preconnectionOptions,
	terminal: snapshot.terminal,
	sessionReviewState: snapshot.sessionReviewState
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
		color: project.color,
		showExternalCliSessions: project.showExternalCliSessions,
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
		settings: snapshot.settings,
		skillsCatalog: snapshot.skillsCatalog,
		voice: snapshot.voice,
		gitReview: snapshot.gitReview,
		mcpCatalog: snapshot.mcpCatalog,
		preconnectionOptions: snapshot.preconnectionOptions,
		terminal: snapshot.terminal,
		sessionReviewState: snapshot.sessionReviewState
	} satisfies RpcSessionSnapshot
})

const rpcCheckpointWithFiles = (
	row: RpcSessionSnapshot["checkpoints"][number],
	files: RpcSessionSnapshot["checkpoints"][number]["files"]
) => ({
	checkpointId: row.checkpointId,
	sessionId: row.sessionId,
	sequence: row.sequence,
	checkpointNumber: row.checkpointNumber,
	name: row.name,
	isAuto: row.isAuto,
	toolCallId: row.toolCallId,
	fileCount: row.fileCount,
	status: row.status,
	createdAt: row.createdAt,
	lastRevertedAt: row.lastRevertedAt,
	files
})

const withCheckpointFiles = Effect.fn("withCheckpointFiles")(function*(
	snapshot: RpcSessionSnapshot
) {
	const checkpoints = yield* CheckpointService
	const rows = yield* Effect.forEach(snapshot.checkpoints, (row) =>
		checkpoints.getFileSnapshots(row.sessionId, row.checkpointId).pipe(
			Effect.map((snaps) =>
				rpcCheckpointWithFiles(
					row,
					Arr.map(snaps, (snap) => ({
						path: snap.filePath,
						contentHash: snap.contentHash,
						fileSize: snap.fileSize,
						linesAdded: snap.linesAdded,
						linesRemoved: snap.linesRemoved,
						content: snap.content
					}))
				)
			),
			Effect.catchTag("CheckpointNotFoundError", () =>
				Effect.succeed(rpcCheckpointWithFiles(row, Arr.empty()))
			),
			Effect.tapCause((cause) =>
				Effect.logWarning(`checkpoint files unavailable: ${Cause.pretty(cause)}`)
			),
			Effect.orElseSucceed(() => rpcCheckpointWithFiles(row, Arr.empty()))
		)
	)
	return {
		snapshotSequence: snapshot.snapshotSequence,
		session: snapshot.session,
		messages: snapshot.messages,
		turns: snapshot.turns,
		activities: snapshot.activities,
		pendingApprovals: snapshot.pendingApprovals,
		checkpoints: rows,
		projects: snapshot.projects,
		sessions: snapshot.sessions,
		settings: snapshot.settings,
		skillsCatalog: snapshot.skillsCatalog,
		voice: snapshot.voice,
		gitReview: snapshot.gitReview,
		mcpCatalog: snapshot.mcpCatalog,
		preconnectionOptions: snapshot.preconnectionOptions,
		terminal: snapshot.terminal,
		sessionReviewState: snapshot.sessionReviewState
	} satisfies RpcSessionSnapshot
})

export const rpcSnapshotForRequest = Effect.fn("rpcSnapshotForRequest")(function*(
	request: SnapshotRequest
) {
	const snapshots = yield* ProjectionSnapshotQuery
	const git = yield* GitService
	const snap = yield* snapshots.forRequest(request)
	return yield* withCheckpointFiles(
		yield* withProjectGitStatus(git, toRpcSnapshot(snap), request)
	)
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

// Provider discovery only fails on real disk I/O trouble (permissions, a
// path that turned out not to be a directory mid-scan); there is no
// invariant to report separately, so this folds straight into the generic
// schema-error shape RpcServerError already has for "something unexpected".
export type ProviderDiscoveryRpcErrorInput = PlatformError | SqlError | Schema.SchemaError

export const toProviderDiscoveryRpcError = (
	error: ProviderDiscoveryRpcErrorInput
): RpcServerError => {
	if (error._tag === "PlatformError") {
		return new RpcSchemaError({ issue: error.message })
	}
	// Reading the projection to tell an Acepe session from an external one
	// puts the store's own failures on this path too; they map the same way
	// every other projection read does.
	return toRpcError(error)
}

// importProviderSession's error channel is HistoryImportError, a superset of
// what toRpcError already handles (OrchestrationDispatchError |
// Schema.SchemaError | SqlError) plus PlatformError (raw disk I/O, same
// fallback as provider discovery above) and HistoryDirectoryNotFoundError
// (unreachable here in practice -- importSessionFile never calls
// listJsonlFiles -- but part of the shared error union).
export const toHistoryImportRpcError = (error: HistoryImportError): RpcServerError => {
	if (error._tag === "PlatformError" || error._tag === "HistoryDirectoryNotFoundError") {
		return new RpcSchemaError({ issue: error.message })
	}
	return toRpcError(error)
}

// Finds the existing project for a workspace root (so importing a session
// under a project the user already added reuses that project's id and does
// not fork a second row), or mints a deterministic id from the path when no
// such project exists yet -- deterministic so two concurrent imports of
// sessions under the same not-yet-registered project race onto the same
// project.create commandId instead of creating duplicates.
export const resolveHistoryImportProjectId = Effect.fn("resolveHistoryImportProjectId")(function*(
	projects: ProjectionProjectsShape,
	workspaceRoot: TrimmedNonEmptyString
) {
	const existing = yield* projects.list()
	const found = Arr.findFirst(
		existing,
		(project) => project.workspaceRoot === workspaceRoot && project.deletedAt === null
	)
	if (Option.isSome(found)) {
		return found.value.projectId
	}
	return yield* decodeProjectId(`history-claude-${pathToSlug(workspaceRoot)}`)
})

export const importProviderSessionHandler = Effect.fn("importProviderSessionHandler")(function*(
	discovery: ProviderSessionDiscoveryShape,
	claudeHistory: HistoryImporterShape,
	projects: ProjectionProjectsShape,
	request: ImportProviderSessionRequest
) {
	// The webview never names a raw file path -- the actual source file
	// always comes back through the same discovery scan
	// `listProviderSessions` uses, confined to the provider's own roots.
	const fallbackSessionId = yield* decodeSessionId(request.sessionId)
	const sessions = yield* discovery.listSessionsForProject(request.projectPath)
	const found = Arr.findFirst(sessions, (session) => session.id === request.sessionId)
	if (Option.isNone(found)) {
		return { sessionId: fallbackSessionId, imported: false }
	}
	const projectId = yield* resolveHistoryImportProjectId(projects, request.projectPath)
	const result = yield* claudeHistory.importSessionFile(
		{ root: request.projectPath, projectId, workspaceRoot: request.projectPath },
		found.value.sourcePath
	)
	return {
		sessionId: Option.getOrElse(result.sessionId, () => fallbackSessionId),
		imported: Option.isSome(result.sessionId)
	}
})

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

export const dispatchOrchestrationCommand = Effect.fn("dispatchOrchestrationCommand")(function*(
	command: OrchestrationCommand
) {
	const engine = yield* OrchestrationEngine
	const filledSkills = yield* fillSkillsDiscoverCommand(command)
	const filledVoice = yield* fillVoiceCommand(filledSkills)
	const filledGit = yield* fillGitCommand(filledVoice)
	const filledAcp = yield* fillAcpCommand(filledGit)
	const filledMcp = yield* fillMcpCommand(filledAcp)
	const filledTerminal = yield* fillTerminalCommand(filledMcp)
	const filled = yield* fillCheckpointCommand(filledTerminal)
	return yield* engine.dispatch(filled)
})

/**
 * Applies the project's own `showExternalCliSessions` preference before the
 * webview ever sees the list. The sidebar renders what discovery returns, so
 * a session Acepe never started must be gone by the time it leaves the
 * server -- filtering it in a Svelte component would leave the client's
 * model disagreeing with the server's.
 *
 * A project the scan finds but the projection does not know (discovery works
 * on any path on disk, registered or not) falls back to the same default the
 * projection stores for an untouched project: external sessions stay hidden.
 */
export const listProviderSessionsHandler = Effect.fn("listProviderSessionsHandler")(function*(
	providerDiscovery: ProviderSessionDiscoveryShape,
	projects: ProjectionProjectsShape,
	request: ListProviderSessionsRequest
) {
	const discovered = yield* providerDiscovery.listSessionsForProject(request.projectPath)
	const projected = yield* projects.list()
	const match = Arr.findFirst(
		projected,
		(project) => project.deletedAt === null && project.workspaceRoot === request.projectPath
	)
	const showExternal = Option.match(match, {
		onNone: () => DEFAULT_SHOW_EXTERNAL_CLI_SESSIONS,
		onSome: (project) => project.showExternalCliSessions
	})
	if (showExternal) {
		return discovered
	}
	return Arr.filter(discovered, (session) => session.origin === "acepe")
})

export const RpcHandlersLive = AcepeRpc.toLayer(
	Effect.gen(function*() {
		const engine = yield* OrchestrationEngine
		const store = yield* OrchestrationEventStore
		const fileIndex = yield* FileIndexService
		const providerDiscovery = yield* ProviderSessionDiscovery
		const claudeHistory = yield* ClaudeHistory
		const projects = yield* ProjectionProjects
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const providerUsage = yield* ProviderUsageService
		return {
			dispatch: (command) =>
				dispatchOrchestrationCommand(command).pipe(Effect.mapError(toRpcError)),
			snapshot: (request) =>
				rpcSnapshotForRequest(request).pipe(
					Effect.flatMap(decodeRpcSessionSnapshot),
					Effect.mapError(toRpcError)
				),
			events: (request) => eventsFromSequence(store, engine, request.fromSequence),
			getProjectIndex: (request) =>
				fileIndex.getProjectIndex(request.projectPath).pipe(Effect.mapError(toFileIndexRpcError)),
			invalidateProjectIndex: (request) => fileIndex.invalidate(request.projectPath),
			readTextFile: (request) => guardedReadTextFile(fs, path, request),
			writeTextFile: (request) => guardedWriteTextFile(fs, path, request),
			getDefaultShell: () => getDefaultShellUtil(),
			gitCall: (request) => routeGitCall(request),
			agentCall: (request) => routeAgentCall(request),
			getProviderAccountUsage: (request) => providerUsage.getUsage(request),
			listProviderSessions: (request) =>
				listProviderSessionsHandler(providerDiscovery, projects, request).pipe(
					Effect.mapError(toProviderDiscoveryRpcError)
				),
			listProviderProjects: () =>
				providerDiscovery.listProjects().pipe(Effect.mapError(toProviderDiscoveryRpcError)),
			importProviderSession: (request) =>
				importProviderSessionHandler(providerDiscovery, claudeHistory, projects, request).pipe(
					Effect.mapError(toHistoryImportRpcError)
				)
		}
	})
)
