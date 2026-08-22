import {
	CheckpointFileCount,
	CheckpointNumber,
	CheckpointStatus,
	IsoDateTime,
	Sequence,
	TrimmedNonEmptyString,
} from "./baseSchemas.ts"
import { OrchestrationEvent } from "./events.ts"
import {
	FileGitStatus,
	GetProjectIndexRequest,
	InvalidateProjectIndexRequest,
	ProjectIndex,
} from "./fileIndex.ts"
import {
	ActivityId,
	ApprovalRequestId,
	CheckpointId,
	CommandId,
	ProjectId,
	SessionId,
	ToolCallId,
	TurnId,
} from "./ids.ts"
import { OrchestrationCommand, SessionPrLinkMode, SessionPrNumber } from "./orchestration.ts"
import { UserSettingKey, SettingsValue } from "./settings.ts"
import { ProjectedSkillsCatalog } from "./skills.ts"
import * as Arr from "effect/Array"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Filter from "effect/Filter"
import * as Option from "effect/Option"
import * as Record from "effect/Record"
import * as Ref from "effect/Ref"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import * as RpcSchema from "effect/unstable/rpc/RpcSchema"

export const RPC_PRIMITIVE_TAGS = [
	"dispatch",
	"snapshot",
	"events",
	"getProjectIndex",
	"invalidateProjectIndex",
] as const
export type RpcPrimitiveTag = (typeof RPC_PRIMITIVE_TAGS)[number]

export class RpcCommandInvariantError extends Schema.TaggedError<RpcCommandInvariantError>()(
	"OrchestrationCommandInvariantError",
	{
		commandType: Schema.String,
		detail: Schema.String,
	},
) {}

export class RpcCommandPreviouslyRejectedError extends Schema.TaggedError<RpcCommandPreviouslyRejectedError>()(
	"OrchestrationCommandPreviouslyRejectedError",
	{
		commandId: CommandId,
		reason: TrimmedNonEmptyString,
	},
) {}

export class RpcProjectorDecodeError extends Schema.TaggedError<RpcProjectorDecodeError>()(
	"OrchestrationProjectorDecodeError",
	{
		eventType: Schema.String,
		field: Schema.String,
		issue: Schema.String,
	},
) {}

export class RpcEngineShutdownError extends Schema.TaggedError<RpcEngineShutdownError>()(
	"OrchestrationEngineShutdownError",
	{},
) {}

export class RpcSqlError extends Schema.TaggedError<RpcSqlError>()("SqlError", {
	reason: Schema.String,
}) {}

export class RpcSchemaError extends Schema.TaggedError<RpcSchemaError>()("SchemaError", {
	issue: Schema.String,
}) {}

export class RpcFileIndexRootNotFoundError extends Schema.TaggedError<RpcFileIndexRootNotFoundError>()(
	"FileIndexRootNotFoundError",
	{
		path: Schema.String,
	},
) {}

export class RpcFileIndexNotADirectoryError extends Schema.TaggedError<RpcFileIndexNotADirectoryError>()(
	"FileIndexNotADirectoryError",
	{
		path: Schema.String,
	},
) {}

export class RpcTransportError extends Schema.TaggedError<RpcTransportError>()("RpcTransportError", {
	reason: Schema.String,
}) {}

export class RpcEventSequenceGapError extends Schema.TaggedError<RpcEventSequenceGapError>()(
	"RpcEventSequenceGapError",
	{
		last: Sequence,
		received: Sequence,
	},
) {}

export const RpcServerError = Schema.Union([
	RpcCommandInvariantError,
	RpcCommandPreviouslyRejectedError,
	RpcProjectorDecodeError,
	RpcEngineShutdownError,
	RpcSqlError,
	RpcSchemaError,
	RpcFileIndexRootNotFoundError,
	RpcFileIndexNotADirectoryError,
])
export type RpcServerError = typeof RpcServerError.Type

export const RpcClientError = Schema.Union([
	RpcServerError,
	RpcTransportError,
	RpcEventSequenceGapError,
])
export type RpcClientError = typeof RpcClientError.Type

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const RpcTextContent = Schema.Struct({
	text: TrimmedNonEmptyString,
})
export type RpcTextContent = typeof RpcTextContent.Type

export const RpcCompactionSeamContent = Schema.Struct({
	status: Schema.Literals(["preparing", "completed", "usage_reset", "failed"]),
	trigger: Schema.Literals(["auto", "manual", "unknown"]),
	preCompactionTokens: Schema.NullOr(NonNegativeInt),
	postCompactionTokens: Schema.NullOr(NonNegativeInt),
	contextWindowSize: Schema.NullOr(NonNegativeInt),
	droppedTokens: Schema.NullOr(NonNegativeInt),
	summary: Schema.NullOr(Schema.String),
})
export type RpcCompactionSeamContent = typeof RpcCompactionSeamContent.Type

export const RpcProjectedProject = Schema.Struct({
	projectId: ProjectId,
	title: TrimmedNonEmptyString,
	workspaceRoot: TrimmedNonEmptyString,
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	deletedAt: Schema.NullOr(IsoDateTime),
	sessionCount: NonNegativeInt,
	// null means git could not be read at all: no binary, no permission, or a
	// schema mismatch. An empty array means git ran and the tree is clean. A
	// review panel must not show "no changes" when git actually failed.
	gitStatus: FileGitStatus.pipe(Schema.Array, Schema.NullOr),
})
export type RpcProjectedProject = typeof RpcProjectedProject.Type

export const RpcProjectedSession = Schema.Struct({
	sessionId: SessionId,
	projectId: ProjectId,
	title: TrimmedNonEmptyString,
	provider: Schema.NullOr(TrimmedNonEmptyString),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	lastActivityAt: IsoDateTime,
	archivedAt: Schema.NullOr(IsoDateTime),
	deletedAt: Schema.NullOr(IsoDateTime),
	prNumber: SessionPrNumber.pipe(Schema.NullOr),
	prLinkMode: SessionPrLinkMode.pipe(Schema.NullOr),
})
export type RpcProjectedSession = typeof RpcProjectedSession.Type

export const RpcUserProjectedMessage = Schema.Struct({
	sessionId: SessionId,
	sequence: Sequence,
	messageId: TrimmedNonEmptyString,
	turnId: Schema.NullOr(TurnId),
	rowType: Schema.Literal("user"),
	content: RpcTextContent,
})
export type RpcUserProjectedMessage = typeof RpcUserProjectedMessage.Type

export const RpcAssistantProjectedMessage = Schema.Struct({
	sessionId: SessionId,
	sequence: Sequence,
	messageId: TrimmedNonEmptyString,
	turnId: Schema.NullOr(TurnId),
	rowType: Schema.Literal("assistant"),
	content: RpcTextContent,
})
export type RpcAssistantProjectedMessage = typeof RpcAssistantProjectedMessage.Type

export const RpcCompactionProjectedMessage = Schema.Struct({
	sessionId: SessionId,
	sequence: Sequence,
	messageId: TrimmedNonEmptyString,
	turnId: Schema.NullOr(TurnId),
	rowType: Schema.Literal("compaction"),
	content: RpcCompactionSeamContent,
})
export type RpcCompactionProjectedMessage = typeof RpcCompactionProjectedMessage.Type

export const RpcProjectedMessage = Schema.Union([
	RpcUserProjectedMessage,
	RpcAssistantProjectedMessage,
	RpcCompactionProjectedMessage,
])
export type RpcProjectedMessage = typeof RpcProjectedMessage.Type

export const RpcProjectedTurn = Schema.Struct({
	turnId: TurnId,
	sessionId: SessionId,
	sequence: Sequence,
})
export type RpcProjectedTurn = typeof RpcProjectedTurn.Type

export const RpcProjectedSessionActivity = Schema.Struct({
	activityId: ActivityId,
	sessionId: SessionId,
	sequence: Sequence,
})
export type RpcProjectedSessionActivity = typeof RpcProjectedSessionActivity.Type

export const RpcProjectedPendingApproval = Schema.Struct({
	approvalRequestId: ApprovalRequestId,
	sessionId: SessionId,
	sequence: Sequence,
})
export type RpcProjectedPendingApproval = typeof RpcProjectedPendingApproval.Type

export const RpcProjectedCheckpoint = Schema.Struct({
	checkpointId: CheckpointId,
	sessionId: SessionId,
	sequence: Sequence,
	checkpointNumber: CheckpointNumber,
	name: Schema.NullOr(TrimmedNonEmptyString),
	isAuto: Schema.Boolean,
	toolCallId: Schema.NullOr(ToolCallId),
	fileCount: CheckpointFileCount,
	status: CheckpointStatus,
	createdAt: IsoDateTime,
	lastRevertedAt: Schema.NullOr(IsoDateTime),
})
export type RpcProjectedCheckpoint = typeof RpcProjectedCheckpoint.Type

export const RpcProjectedSetting = Schema.Struct({
	key: UserSettingKey,
	value: SettingsValue,
	sequence: Sequence,
})
export type RpcProjectedSetting = typeof RpcProjectedSetting.Type

export const RpcSkillsCatalog = ProjectedSkillsCatalog
export type RpcSkillsCatalog = typeof RpcSkillsCatalog.Type

export const RpcSessionSnapshot = Schema.Struct({
	snapshotSequence: Sequence,
	session: Schema.NullOr(RpcProjectedSession),
	messages: Schema.Array(RpcProjectedMessage),
	turns: Schema.Array(RpcProjectedTurn),
	activities: Schema.Array(RpcProjectedSessionActivity),
	pendingApprovals: Schema.Array(RpcProjectedPendingApproval),
	checkpoints: Schema.Array(RpcProjectedCheckpoint),
	projects: Schema.Array(RpcProjectedProject),
	sessions: Schema.Array(RpcProjectedSession),
	settings: Schema.Array(RpcProjectedSetting),
	skillsCatalog: Schema.NullOr(RpcSkillsCatalog),
})
export type RpcSessionSnapshot = typeof RpcSessionSnapshot.Type

export const RpcDispatchResult = Schema.Struct({
	sequence: Sequence,
})
export type RpcDispatchResult = typeof RpcDispatchResult.Type

export const LibrarySnapshotRequest = Schema.Struct({
	kind: Schema.Literal("library"),
})
export type LibrarySnapshotRequest = typeof LibrarySnapshotRequest.Type

export const SettingsSnapshotRequest = Schema.Struct({
	kind: Schema.Literal("settings"),
})
export type SettingsSnapshotRequest = typeof SettingsSnapshotRequest.Type

export const SkillsSnapshotRequest = Schema.Struct({
	kind: Schema.Literal("skills"),
})
export type SkillsSnapshotRequest = typeof SkillsSnapshotRequest.Type

export const ProjectSnapshotRequest = Schema.Struct({
	kind: Schema.Literal("project"),
	projectId: ProjectId,
})
export type ProjectSnapshotRequest = typeof ProjectSnapshotRequest.Type

export const SessionSnapshotRequest = Schema.Struct({
	kind: Schema.Literal("session"),
	sessionId: SessionId,
})
export type SessionSnapshotRequest = typeof SessionSnapshotRequest.Type

export const LegacySessionSnapshotRequest = Schema.Struct({
	sessionId: SessionId,
})
export type LegacySessionSnapshotRequest = typeof LegacySessionSnapshotRequest.Type

export const SnapshotRequest = Schema.Union([
	LibrarySnapshotRequest,
	SettingsSnapshotRequest,
	SkillsSnapshotRequest,
	ProjectSnapshotRequest,
	SessionSnapshotRequest,
	LegacySessionSnapshotRequest,
])
export type SnapshotRequest = typeof SnapshotRequest.Type

export type SnapshotScope =
	| {
			readonly kind: "library"
	  }
	| {
			readonly kind: "settings"
	  }
	| {
			readonly kind: "skills"
	  }
	| {
			readonly kind: "project"
			readonly projectId: ProjectId
	  }
	| {
			readonly kind: "session"
			readonly sessionId: SessionId
	  }

export const librarySnapshotRequest = (): LibrarySnapshotRequest => ({
	kind: "library",
})

export const settingsSnapshotRequest = (): SettingsSnapshotRequest => ({
	kind: "settings",
})

export const skillsSnapshotRequest = (): SkillsSnapshotRequest => ({
	kind: "skills",
})

export const projectSnapshotRequest = (projectId: ProjectId): ProjectSnapshotRequest => ({
	kind: "project",
	projectId,
})

export const sessionSnapshotRequest = (sessionId: SessionId): SessionSnapshotRequest => ({
	kind: "session",
	sessionId,
})

export const snapshotScope = (request: SnapshotRequest): SnapshotScope => {
	if (Schema.is(LibrarySnapshotRequest)(request)) {
		return { kind: "library" }
	}
	if (Schema.is(SettingsSnapshotRequest)(request)) {
		return { kind: "settings" }
	}
	if (Schema.is(SkillsSnapshotRequest)(request)) {
		return { kind: "skills" }
	}
	if (Schema.is(ProjectSnapshotRequest)(request)) {
		return { kind: "project", projectId: request.projectId }
	}
	if (Schema.is(SessionSnapshotRequest)(request)) {
		return { kind: "session", sessionId: request.sessionId }
	}
	return { kind: "session", sessionId: request.sessionId }
}

export const EventsRequest = Schema.Struct({
	fromSequence: Sequence,
})
export type EventsRequest = typeof EventsRequest.Type

export class Dispatch extends Rpc.make("dispatch", {
	payload: OrchestrationCommand,
	success: RpcDispatchResult,
	error: RpcServerError,
}) {}

export class Snapshot extends Rpc.make("snapshot", {
	payload: SnapshotRequest,
	success: RpcSessionSnapshot,
	error: RpcServerError,
}) {}

export class Events extends Rpc.make("events", {
	payload: EventsRequest,
	success: OrchestrationEvent,
	error: RpcClientError,
	stream: true,
}) {}

export class GetProjectIndex extends Rpc.make("getProjectIndex", {
	payload: GetProjectIndexRequest,
	success: ProjectIndex,
	error: RpcServerError,
}) {}

export class InvalidateProjectIndex extends Rpc.make("invalidateProjectIndex", {
	payload: InvalidateProjectIndexRequest,
	success: Schema.Void,
	error: RpcServerError,
}) {}

export const AcepeRpc = RpcGroup.make(
	Dispatch,
	Snapshot,
	Events,
	GetProjectIndex,
	InvalidateProjectIndex,
)

type GroupTag = Rpc.Tag<RpcGroup.Rpcs<typeof AcepeRpc>>
const _threePrimitives: [RpcPrimitiveTag] extends [GroupTag]
	? [GroupTag] extends [RpcPrimitiveTag]
		? true
		: never
	: never = true
void _threePrimitives

export const DispatchExit = Rpc.exitSchema(Dispatch)
export const SnapshotExit = Rpc.exitSchema(Snapshot)
export const GetProjectIndexExit = Rpc.exitSchema(GetProjectIndex)
export const InvalidateProjectIndexExit = Rpc.exitSchema(InvalidateProjectIndex)

export type ElectrobunRequestSpec = {
	readonly params: Schema.Top
	readonly response: Schema.Top
}

export type GeneratedElectrobunRpcSchema = {
	readonly bun: {
		readonly requests: Record<string, ElectrobunRequestSpec>
		readonly messages: Record<string, never>
	}
	readonly webview: {
		readonly requests: Record<string, never>
		readonly messages: Record<string, Schema.Top>
	}
}

const requestSpecFor = (rpc: Rpc.AnyWithProps): readonly [string, ElectrobunRequestSpec] => {
	if (RpcSchema.isStreamSchema(rpc.successSchema)) {
		return [
			rpc._tag,
			{
				params: rpc.payloadSchema,
				response: Schema.Void,
			},
		]
	}
	return [
		rpc._tag,
		{
			params: rpc.payloadSchema,
			response: Rpc.exitSchema(rpc),
		},
	]
}

const streamMessageFor = (
	rpc: Rpc.AnyWithProps,
): Option.Option<readonly [string, Schema.Top]> => {
	if (RpcSchema.isStreamSchema(rpc.successSchema) === false) {
		return Option.none()
	}
	return Option.some([rpc._tag, rpc.successSchema.success])
}

export const generateElectrobunRpcSchema = (
	group: typeof AcepeRpc = AcepeRpc,
): GeneratedElectrobunRpcSchema => {
	const rpcs = Arr.fromIterable(group.requests.values())
	const requestEntries = Arr.map(rpcs, requestSpecFor)
	const messageEntries = Arr.filterMap(rpcs, Filter.fromPredicateOption(streamMessageFor))
	return {
		bun: {
			requests: Record.fromEntries(requestEntries),
			messages: {},
		},
		webview: {
			requests: {},
			messages: Record.fromEntries(messageEntries),
		},
	}
}

export type AcepeElectrobunRpcSchema = {
	readonly bun: {
		readonly requests: {
			readonly dispatch: {
				readonly params: typeof OrchestrationCommand.Encoded
				readonly response: typeof DispatchExit.Encoded
			}
			readonly snapshot: {
				readonly params: typeof SnapshotRequest.Encoded
				readonly response: typeof SnapshotExit.Encoded
			}
			readonly events: {
				readonly params: typeof EventsRequest.Encoded
				readonly response: void
			}
			readonly getProjectIndex: {
				readonly params: typeof GetProjectIndexRequest.Encoded
				readonly response: typeof GetProjectIndexExit.Encoded
			}
			readonly invalidateProjectIndex: {
				readonly params: typeof InvalidateProjectIndexRequest.Encoded
				readonly response: typeof InvalidateProjectIndexExit.Encoded
			}
		}
		readonly messages: Record<string, never>
	}
	readonly webview: {
		readonly requests: Record<string, never>
		readonly messages: {
			readonly events: typeof OrchestrationEvent.Encoded
		}
	}
}

const dispatchExitJson = Schema.toCodecJson(DispatchExit)
const snapshotExitJson = Schema.toCodecJson(SnapshotExit)
const getProjectIndexExitJson = Schema.toCodecJson(GetProjectIndexExit)
const invalidateProjectIndexExitJson = Schema.toCodecJson(InvalidateProjectIndexExit)

export const decodeDispatchExit = Schema.decodeUnknownEffect(dispatchExitJson)
export const decodeSnapshotExit = Schema.decodeUnknownEffect(snapshotExitJson)
export const decodeGetProjectIndexExit = Schema.decodeUnknownEffect(getProjectIndexExitJson)
export const decodeInvalidateProjectIndexExit = Schema.decodeUnknownEffect(
	invalidateProjectIndexExitJson,
)
export const encodeDispatchExit = Schema.encodeUnknownEffect(dispatchExitJson)
export const encodeSnapshotExit = Schema.encodeUnknownEffect(snapshotExitJson)
export const encodeGetProjectIndexExit = Schema.encodeUnknownEffect(getProjectIndexExitJson)
export const encodeInvalidateProjectIndexExit = Schema.encodeUnknownEffect(
	invalidateProjectIndexExitJson,
)
export const decodeEventsRequest = Schema.decodeUnknownEffect(EventsRequest)
export const decodeSnapshotRequest = Schema.decodeUnknownEffect(SnapshotRequest)
export const decodeGetProjectIndexRequest = Schema.decodeUnknownEffect(GetProjectIndexRequest)
export const decodeInvalidateProjectIndexRequest = Schema.decodeUnknownEffect(
	InvalidateProjectIndexRequest,
)
export const decodeOrchestrationCommand = Schema.decodeUnknownEffect(OrchestrationCommand)
export const encodeOrchestrationCommand = Schema.encodeUnknownEffect(OrchestrationCommand)
export const encodeOrchestrationEvent = Schema.encodeUnknownEffect(OrchestrationEvent)
export const decodeOrchestrationEvent = Schema.decodeUnknownEffect(OrchestrationEvent)
export const encodeRpcSessionSnapshot = Schema.encodeUnknownEffect(RpcSessionSnapshot)
export const decodeRpcSessionSnapshot = Schema.decodeUnknownEffect(RpcSessionSnapshot)

export const exitToEffect = <A, E>(exit: Exit.Exit<A, E>): Effect.Effect<A, E> =>
	Exit.match(exit, {
		onSuccess: (value) => Effect.succeed(value),
		onFailure: (cause) => Effect.failCause(cause),
	})

export type RpcTransport<R = never> = {
	readonly dispatch: (
		command: OrchestrationCommand,
	) => Effect.Effect<RpcDispatchResult, RpcClientError, R>
	readonly snapshot: (
		request: SnapshotRequest,
	) => Effect.Effect<RpcSessionSnapshot, RpcClientError, R>
	readonly events: (
		fromSequence: Sequence,
	) => Stream.Stream<OrchestrationEvent, RpcClientError, R>
	readonly getProjectIndex: (
		projectPath: TrimmedNonEmptyString,
	) => Effect.Effect<ProjectIndex, RpcClientError, R>
	readonly invalidateProjectIndex: (
		projectPath: TrimmedNonEmptyString,
	) => Effect.Effect<void, RpcClientError, R>
}

export type RpcClient<R = never> = RpcTransport<R>

const considerEvent = (
	cursor: Ref.Ref<Sequence>,
	event: OrchestrationEvent,
): Effect.Effect<
	Result.Result<OrchestrationEvent, OrchestrationEvent>,
	RpcTransportError | RpcEventSequenceGapError
> =>
	Effect.gen(function*() {
		const last = yield* Ref.get(cursor)
		if (event.sequence <= last) {
			return Result.fail(event)
		}
		if (last > 0 && event.sequence > last + 1) {
			return yield* new RpcEventSequenceGapError({
				last,
				received: event.sequence,
			})
		}
		yield* Ref.set(cursor, event.sequence)
		return Result.succeed(event)
	})

const exclusiveEvents = <R>(
	events: Stream.Stream<OrchestrationEvent, RpcClientError, R>,
	cursor: Ref.Ref<Sequence>,
): Stream.Stream<OrchestrationEvent, RpcClientError, R> =>
	Stream.filterMapEffect(
		events,
		Filter.makeEffect<
			OrchestrationEvent,
			OrchestrationEvent,
			OrchestrationEvent,
			RpcTransportError | RpcEventSequenceGapError,
			never
		>((event) => considerEvent(cursor, event)),
	)

const resumeEvents = <R>(
	transport: RpcTransport<R>,
	cursor: Ref.Ref<Sequence>,
): Stream.Stream<OrchestrationEvent, RpcClientError, R> =>
	Stream.suspend(() =>
		Ref.get(cursor).pipe(
			Effect.map((fromSequence) =>
				exclusiveEvents(transport.events(fromSequence), cursor).pipe(
					Stream.concat(Stream.fail(new RpcTransportError({ reason: "stream ended" }))),
					Stream.catchTag("RpcTransportError", (_error) =>
						Effect.sleep(Duration.millis(10)).pipe(
							Effect.as(resumeEvents(transport, cursor)),
							Stream.unwrap,
						),
					),
				),
			),
			Stream.unwrap,
		),
	)

export const makeResumingRpcClient = <R>(transport: RpcTransport<R>): RpcClient<R> => ({
	dispatch: transport.dispatch,
	snapshot: transport.snapshot,
	getProjectIndex: transport.getProjectIndex,
	invalidateProjectIndex: transport.invalidateProjectIndex,
	events: (fromSequence) =>
		Stream.unwrap(
			Ref.make(fromSequence).pipe(Effect.map((cursor) => resumeEvents(transport, cursor))),
		),
})
