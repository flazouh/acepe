import { AgentCallRequest, AgentCallResult } from "./agentCall.ts"
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
import { GetDefaultShellRequest, ReadTextFileRequest, WriteTextFileRequest } from "./fsUtil.ts"
import { ProjectedGitReview } from "./git.ts"
import { GitCallRequest, GitCallResult } from "./gitCall.ts"
import { ProjectedMcpCatalog } from "./mcp.ts"
import { ProjectedPreconnectionOptions } from "./preconnection.ts"
import { ProjectColor } from "./projectColor.ts"
import { GetProviderAccountUsageRequest, GetProviderAccountUsageResponse } from "./providerUsage.ts"
import {
	DiscoveredProviderProject,
	DiscoveredProviderSession,
	ImportProviderSessionRequest,
	ImportProviderSessionResult,
	ListProviderProjectsRequest,
	ListProviderSessionsRequest,
} from "./providerDiscovery.ts"
import { ProjectedSessionReviewState } from "./sessionReview.ts"
import { ProjectedTerminal } from "./terminal.ts"
import {
	ActivityId,
	ApprovalRequestId,
	CheckpointId,
	CommandId,
	ProjectId,
	SessionId,
	TerminalId,
	ToolCallId,
	TurnId,
} from "./ids.ts"
import { OrchestrationCommand, SessionPrLinkMode, SessionPrNumber } from "./orchestration.ts"
import { UserSettingKey, SettingsValue } from "./settings.ts"
import { ProjectedSkillsCatalog } from "./skills.ts"
import { ProjectedVoice } from "./voice.ts"
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
	"readTextFile",
	"writeTextFile",
	"getDefaultShell",
	"gitCall",
	"agentCall",
	"getProviderAccountUsage",
	"listProviderSessions",
	"listProviderProjects",
	"importProviderSession",
] as const
export type RpcPrimitiveTag = (typeof RPC_PRIMITIVE_TAGS)[number]

export class RpcCommandInvariantError extends Schema.TaggedError<RpcCommandInvariantError>()(
	"OrchestrationCommandInvariantError",
	{
		commandType: Schema.String,
		detail: Schema.String,
	},
) {
	override get message(): string {
		return this.detail
	}
}

export class RpcCommandPreviouslyRejectedError extends Schema.TaggedError<RpcCommandPreviouslyRejectedError>()(
	"OrchestrationCommandPreviouslyRejectedError",
	{
		commandId: CommandId,
		reason: TrimmedNonEmptyString,
	},
) {
	override get message(): string {
		return `Command ${this.commandId} was previously rejected: ${this.reason}`
	}
}

export class RpcProjectorDecodeError extends Schema.TaggedError<RpcProjectorDecodeError>()(
	"OrchestrationProjectorDecodeError",
	{
		eventType: Schema.String,
		field: Schema.String,
		issue: Schema.String,
	},
) {
	override get message(): string {
		return `Failed to decode field '${this.field}' of ${this.eventType}: ${this.issue}`
	}
}

export class RpcEngineShutdownError extends Schema.TaggedError<RpcEngineShutdownError>()(
	"OrchestrationEngineShutdownError",
	{},
) {}

export class RpcSqlError extends Schema.TaggedError<RpcSqlError>()("SqlError", {
	reason: Schema.String,
}) {
	override get message(): string {
		return `SQL error: ${this.reason}`
	}
}

export class RpcSchemaError extends Schema.TaggedError<RpcSchemaError>()("SchemaError", {
	issue: Schema.String,
}) {
	override get message(): string {
		return `Schema error: ${this.issue}`
	}
}

export class RpcFileIndexRootNotFoundError extends Schema.TaggedError<RpcFileIndexRootNotFoundError>()(
	"FileIndexRootNotFoundError",
	{
		path: Schema.String,
	},
) {
	override get message(): string {
		return `File index root not found: ${this.path}`
	}
}

export class RpcFileIndexNotADirectoryError extends Schema.TaggedError<RpcFileIndexNotADirectoryError>()(
	"FileIndexNotADirectoryError",
	{
		path: Schema.String,
	},
) {
	override get message(): string {
		return `Not a directory: ${this.path}`
	}
}

export class RpcTransportError extends Schema.TaggedError<RpcTransportError>()("RpcTransportError", {
	reason: Schema.String,
}) {
	override get message(): string {
		return `RPC transport error: ${this.reason}`
	}
}

export class RpcEventSequenceGapError extends Schema.TaggedError<RpcEventSequenceGapError>()(
	"RpcEventSequenceGapError",
	{
		last: Sequence,
		received: Sequence,
	},
) {
	override get message(): string {
		return `Event sequence gap: last seen ${this.last}, received ${this.received}`
	}
}

export class RpcFsPathDeniedError extends Schema.TaggedError<RpcFsPathDeniedError>()(
	"RpcFsPathDeniedError",
	{
		path: Schema.String,
	},
) {
	override get message(): string {
		return `Path is outside the allowed roots: ${this.path}`
	}
}

export class RpcGitCallError extends Schema.TaggedError<RpcGitCallError>()(
	"RpcGitCallError",
	{
		op: Schema.String,
		detail: Schema.String,
	},
) {
	override get message(): string {
		return `git ${this.op} failed: ${this.detail}`
	}
}

// Carries which provider's usage fetch failed and why. In practice
// getProviderAccountUsage's handler catches this per-provider (see
// packages/server/src/providerUsage) and folds it into that provider's
// ProviderAccountUsage.connection: "unavailable" entry rather than failing
// the whole request -- the RPC-level union member exists for the rare case
// an unexpected defect needs a typed shape on the wire (e.g. a request
// schema mismatch upstream of per-provider handling).
export class RpcProviderUsageError extends Schema.TaggedError<RpcProviderUsageError>()(
	"RpcProviderUsageError",
	{
		provider: Schema.String,
		detail: Schema.String,
	},
) {
	override get message(): string {
		return `Provider account usage for '${this.provider}' failed: ${this.detail}`
	}
}

export const RpcServerError = Schema.Union([
	RpcCommandInvariantError,
	RpcCommandPreviouslyRejectedError,
	RpcProjectorDecodeError,
	RpcEngineShutdownError,
	RpcSqlError,
	RpcSchemaError,
	RpcFileIndexRootNotFoundError,
	RpcFileIndexNotADirectoryError,
	RpcFsPathDeniedError,
	RpcGitCallError,
	RpcProviderUsageError,
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
	// Always set: the projection assigns a deterministic color when nobody has
	// picked one, so no reader has to invent a color of its own.
	color: ProjectColor,
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
	// The provider's own session identity (e.g. a Claude Code JSONL uuid).
	// Null until the provider's first durable message promotes its session
	// id, and forever null for a session the tracer owns. See
	// packages/server/src/persistence/Services/ProjectionSessions.ts.
	providerSessionId: Schema.NullOr(TrimmedNonEmptyString),
	// True once a ProviderSessionFailed event fired for this session and it
	// never learned a providerSessionId -- a "ghost row" with no on-disk
	// history it could ever open. See providerSessionFailed's doc on the
	// server's ProjectedSession.
	providerSessionFailed: Schema.Boolean,
	// The canonical current mode, folded from SessionModeSet events. A
	// SessionModeSet always wins over the mode a provider reports when it
	// opens the session; null means none ever fired, and only then does the
	// provider's opening mode stand. availableModes stays provider-owned. See
	// currentModeId on the server's ProjectedSession.
	currentModeId: TrimmedNonEmptyString.pipe(Schema.NullOr, Schema.optionalKey),
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

// AC-269: widened so the client can find the running turn and read its live
// token usage for the Claude Code working line -- mirrors
// packages/server/src/persistence/Services/ProjectionTurns.ts's
// ProjectedTurn (the SQL-authoritative shape), same field set and column
// semantics, projected here onto the RPC snapshot.
export const RpcTurnStatus = Schema.Literals(["running", "completed", "cancelled"])
export type RpcTurnStatus = typeof RpcTurnStatus.Type

const RpcNonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const RpcNonNegativeNumber = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))

export const RpcProjectedTurn = Schema.Struct({
	turnId: TurnId,
	sessionId: SessionId,
	sequence: Sequence,
	status: RpcTurnStatus,
	startedAt: Schema.NullOr(Schema.String),
	endedAt: Schema.NullOr(Schema.String),
	inputTokens: RpcNonNegativeInt,
	outputTokens: RpcNonNegativeInt,
	cacheReadTokens: RpcNonNegativeInt,
	cacheWriteTokens: RpcNonNegativeInt,
	costUsd: RpcNonNegativeNumber,
	contextWindowSize: Schema.NullOr(RpcNonNegativeInt),
})
export type RpcProjectedTurn = typeof RpcProjectedTurn.Type

export const RpcProjectedSessionActivity = Schema.Struct({
	activityId: ActivityId,
	sessionId: SessionId,
	sequence: Sequence,
	// `kind` is the ACTIVITY kind ("tool" | "file"). `toolKind` is the
	// provider's tool classification ("edit", "execute", ...), so a reopened
	// session renders the right tool card without re-parsing the display
	// title. Optional + nullable: absent on rows written before the
	// tool_kind column existed.
	kind: Schema.optionalKey(Schema.String),
	toolKind: Schema.String.pipe(Schema.NullOr, Schema.optionalKey),
	status: Schema.optionalKey(Schema.String),
	title: Schema.optionalKey(TrimmedNonEmptyString),
	path: TrimmedNonEmptyString.pipe(Schema.NullOr, Schema.optionalKey),
	toolCallId: ToolCallId.pipe(Schema.NullOr, Schema.optionalKey),
	// #273: the tool's own result. Optional like its siblings, because a
	// non-tool activity row has no output at all, and because a snapshot
	// serialised before this key existed still decodes.
	output: TrimmedNonEmptyString.pipe(Schema.NullOr, Schema.optionalKey),
})
export type RpcProjectedSessionActivity = typeof RpcProjectedSessionActivity.Type

export const RpcProjectedPendingApproval = Schema.Struct({
	approvalRequestId: ApprovalRequestId,
	sessionId: SessionId,
	sequence: Sequence,
	title: Schema.optionalKey(TrimmedNonEmptyString),
})
export type RpcProjectedPendingApproval = typeof RpcProjectedPendingApproval.Type

export const RpcCheckpointFile = Schema.Struct({
	path: TrimmedNonEmptyString,
	contentHash: TrimmedNonEmptyString,
	fileSize: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	linesAdded: Schema.NullOr(Schema.Int),
	linesRemoved: Schema.NullOr(Schema.Int),
	content: Schema.String,
})
export type RpcCheckpointFile = typeof RpcCheckpointFile.Type

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
	files: Schema.Array(RpcCheckpointFile),
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

export const RpcProjectedVoice = ProjectedVoice
export type RpcProjectedVoice = typeof RpcProjectedVoice.Type

export const RpcProjectedGitReview = ProjectedGitReview
export type RpcProjectedGitReview = typeof RpcProjectedGitReview.Type

export const RpcProjectedTerminal = ProjectedTerminal
export type RpcProjectedTerminal = typeof RpcProjectedTerminal.Type

export const RpcProjectedSessionReviewState = ProjectedSessionReviewState
export type RpcProjectedSessionReviewState = typeof RpcProjectedSessionReviewState.Type

export const RpcProjectedMcpCatalog = ProjectedMcpCatalog
export type RpcProjectedMcpCatalog = typeof RpcProjectedMcpCatalog.Type

export const RpcProjectedPreconnectionOptions = ProjectedPreconnectionOptions
export type RpcProjectedPreconnectionOptions = typeof RpcProjectedPreconnectionOptions.Type

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
	voice: Schema.NullOr(RpcProjectedVoice),
	gitReview: Schema.NullOr(RpcProjectedGitReview),
	mcpCatalog: Schema.NullOr(RpcProjectedMcpCatalog),
	preconnectionOptions: Schema.NullOr(RpcProjectedPreconnectionOptions),
	terminal: Schema.NullOr(RpcProjectedTerminal),
	sessionReviewState: Schema.NullOr(RpcProjectedSessionReviewState),
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

export const VoiceSnapshotRequest = Schema.Struct({
	kind: Schema.Literal("voice"),
})
export type VoiceSnapshotRequest = typeof VoiceSnapshotRequest.Type

export const GitSnapshotRequest = Schema.Struct({
	kind: Schema.Literal("git"),
	projectId: ProjectId,
})
export type GitSnapshotRequest = typeof GitSnapshotRequest.Type

export const McpSnapshotRequest = Schema.Struct({
	kind: Schema.Literal("mcp"),
	projectId: ProjectId,
})
export type McpSnapshotRequest = typeof McpSnapshotRequest.Type

export const TerminalSnapshotRequest = Schema.Struct({
	kind: Schema.Literal("terminal"),
	terminalId: TerminalId,
})
export type TerminalSnapshotRequest = typeof TerminalSnapshotRequest.Type

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
	VoiceSnapshotRequest,
	GitSnapshotRequest,
	McpSnapshotRequest,
	TerminalSnapshotRequest,
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
			readonly kind: "voice"
	  }
	| {
			readonly kind: "git"
			readonly projectId: ProjectId
	  }
	| {
			readonly kind: "mcp"
			readonly projectId: ProjectId
	  }
	| {
			readonly kind: "terminal"
			readonly terminalId: TerminalId
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

export const voiceSnapshotRequest = (): VoiceSnapshotRequest => ({
	kind: "voice",
})

export const gitSnapshotRequest = (projectId: ProjectId): GitSnapshotRequest => ({
	kind: "git",
	projectId,
})

export const mcpSnapshotRequest = (projectId: ProjectId): McpSnapshotRequest => ({
	kind: "mcp",
	projectId,
})

export const terminalSnapshotRequest = (terminalId: TerminalId): TerminalSnapshotRequest => ({
	kind: "terminal",
	terminalId,
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
	if (Schema.is(VoiceSnapshotRequest)(request)) {
		return { kind: "voice" }
	}
	if (Schema.is(GitSnapshotRequest)(request)) {
		return { kind: "git", projectId: request.projectId }
	}
	if (Schema.is(McpSnapshotRequest)(request)) {
		return { kind: "mcp", projectId: request.projectId }
	}
	if (Schema.is(TerminalSnapshotRequest)(request)) {
		return { kind: "terminal", terminalId: request.terminalId }
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

export class ReadTextFile extends Rpc.make("readTextFile", {
	payload: ReadTextFileRequest,
	success: Schema.String,
	error: RpcServerError,
}) {}

export class WriteTextFile extends Rpc.make("writeTextFile", {
	payload: WriteTextFileRequest,
	success: Schema.Void,
	error: RpcServerError,
}) {}

export class GetDefaultShell extends Rpc.make("getDefaultShell", {
	payload: GetDefaultShellRequest,
	success: Schema.String,
	error: RpcServerError,
}) {}

export class GitCall extends Rpc.make("gitCall", {
	payload: GitCallRequest,
	success: GitCallResult,
	error: RpcServerError,
}) {}

export class AgentCall extends Rpc.make("agentCall", {
	payload: AgentCallRequest,
	success: AgentCallResult,
	error: RpcServerError,
}) {}

export class GetProviderAccountUsage extends Rpc.make("getProviderAccountUsage", {
	payload: GetProviderAccountUsageRequest,
	success: GetProviderAccountUsageResponse,
	error: RpcServerError,
}) {}

// #249 batch 3: read-time provider discovery. Self-contained block --
// list the sessions/projects a provider has on disk (Claude Code today),
// independent of whether Acepe has imported them yet.
export class ListProviderSessions extends Rpc.make("listProviderSessions", {
	payload: ListProviderSessionsRequest,
	success: Schema.Array(DiscoveredProviderSession),
	error: RpcServerError,
}) {}

export class ListProviderProjects extends Rpc.make("listProviderProjects", {
	payload: ListProviderProjectsRequest,
	success: Schema.Array(DiscoveredProviderProject),
	error: RpcServerError,
}) {}

// Utility RPC (precedent: InvalidateProjectIndex): imports one discovered
// provider session into the orchestration event store on demand. See
// providerDiscovery.ts for why the payload names a project+session rather
// than a raw file path.
export class ImportProviderSession extends Rpc.make("importProviderSession", {
	payload: ImportProviderSessionRequest,
	success: ImportProviderSessionResult,
	error: RpcServerError,
}) {}

export const AcepeRpc = RpcGroup.make(
	Dispatch,
	Snapshot,
	Events,
	GetProjectIndex,
	InvalidateProjectIndex,
	ReadTextFile,
	WriteTextFile,
	GetDefaultShell,
	GitCall,
	AgentCall,
	GetProviderAccountUsage,
	ListProviderSessions,
	ListProviderProjects,
	ImportProviderSession,
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
export const ReadTextFileExit = Rpc.exitSchema(ReadTextFile)
export const WriteTextFileExit = Rpc.exitSchema(WriteTextFile)
export const GetDefaultShellExit = Rpc.exitSchema(GetDefaultShell)
export const GitCallExit = Rpc.exitSchema(GitCall)
export const AgentCallExit = Rpc.exitSchema(AgentCall)
export const GetProviderAccountUsageExit = Rpc.exitSchema(GetProviderAccountUsage)
export const ListProviderSessionsExit = Rpc.exitSchema(ListProviderSessions)
export const ListProviderProjectsExit = Rpc.exitSchema(ListProviderProjects)
export const ImportProviderSessionExit = Rpc.exitSchema(ImportProviderSession)

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
			readonly readTextFile: {
				readonly params: typeof ReadTextFileRequest.Encoded
				readonly response: typeof ReadTextFileExit.Encoded
			}
			readonly writeTextFile: {
				readonly params: typeof WriteTextFileRequest.Encoded
				readonly response: typeof WriteTextFileExit.Encoded
			}
			readonly getDefaultShell: {
				readonly params: typeof GetDefaultShellRequest.Encoded
				readonly response: typeof GetDefaultShellExit.Encoded
			}
			readonly gitCall: {
				readonly params: typeof GitCallRequest.Encoded
				readonly response: typeof GitCallExit.Encoded
			}
			readonly agentCall: {
				readonly params: typeof AgentCallRequest.Encoded
				readonly response: typeof AgentCallExit.Encoded
			}
			readonly getProviderAccountUsage: {
				readonly params: typeof GetProviderAccountUsageRequest.Encoded
				readonly response: typeof GetProviderAccountUsageExit.Encoded
			}
			readonly listProviderSessions: {
				readonly params: typeof ListProviderSessionsRequest.Encoded
				readonly response: typeof ListProviderSessionsExit.Encoded
			}
			readonly listProviderProjects: {
				readonly params: typeof ListProviderProjectsRequest.Encoded
				readonly response: typeof ListProviderProjectsExit.Encoded
			}
			readonly importProviderSession: {
				readonly params: typeof ImportProviderSessionRequest.Encoded
				readonly response: typeof ImportProviderSessionExit.Encoded
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
const readTextFileExitJson = Schema.toCodecJson(ReadTextFileExit)
const writeTextFileExitJson = Schema.toCodecJson(WriteTextFileExit)
const getDefaultShellExitJson = Schema.toCodecJson(GetDefaultShellExit)
const gitCallExitJson = Schema.toCodecJson(GitCallExit)
const agentCallExitJson = Schema.toCodecJson(AgentCallExit)
const getProviderAccountUsageExitJson = Schema.toCodecJson(GetProviderAccountUsageExit)
const listProviderSessionsExitJson = Schema.toCodecJson(ListProviderSessionsExit)
const listProviderProjectsExitJson = Schema.toCodecJson(ListProviderProjectsExit)
const importProviderSessionExitJson = Schema.toCodecJson(ImportProviderSessionExit)

export const decodeDispatchExit = Schema.decodeUnknownEffect(dispatchExitJson)
export const decodeSnapshotExit = Schema.decodeUnknownEffect(snapshotExitJson)
export const decodeGetProjectIndexExit = Schema.decodeUnknownEffect(getProjectIndexExitJson)
export const decodeInvalidateProjectIndexExit = Schema.decodeUnknownEffect(
	invalidateProjectIndexExitJson,
)
export const decodeReadTextFileExit = Schema.decodeUnknownEffect(readTextFileExitJson)
export const decodeWriteTextFileExit = Schema.decodeUnknownEffect(writeTextFileExitJson)
export const decodeGetDefaultShellExit = Schema.decodeUnknownEffect(getDefaultShellExitJson)
export const decodeGitCallExit = Schema.decodeUnknownEffect(gitCallExitJson)
export const decodeAgentCallExit = Schema.decodeUnknownEffect(agentCallExitJson)
export const decodeGetProviderAccountUsageExit = Schema.decodeUnknownEffect(
	getProviderAccountUsageExitJson,
)
export const decodeListProviderSessionsExit = Schema.decodeUnknownEffect(listProviderSessionsExitJson)
export const decodeListProviderProjectsExit = Schema.decodeUnknownEffect(listProviderProjectsExitJson)
export const decodeImportProviderSessionExit = Schema.decodeUnknownEffect(importProviderSessionExitJson)
export const encodeDispatchExit = Schema.encodeUnknownEffect(dispatchExitJson)
export const encodeSnapshotExit = Schema.encodeUnknownEffect(snapshotExitJson)
export const encodeGetProjectIndexExit = Schema.encodeUnknownEffect(getProjectIndexExitJson)
export const encodeInvalidateProjectIndexExit = Schema.encodeUnknownEffect(
	invalidateProjectIndexExitJson,
)
export const encodeReadTextFileExit = Schema.encodeUnknownEffect(readTextFileExitJson)
export const encodeWriteTextFileExit = Schema.encodeUnknownEffect(writeTextFileExitJson)
export const encodeGetDefaultShellExit = Schema.encodeUnknownEffect(getDefaultShellExitJson)
export const encodeGitCallExit = Schema.encodeUnknownEffect(gitCallExitJson)
export const encodeAgentCallExit = Schema.encodeUnknownEffect(agentCallExitJson)
export const encodeGetProviderAccountUsageExit = Schema.encodeUnknownEffect(
	getProviderAccountUsageExitJson,
)
export const encodeListProviderSessionsExit = Schema.encodeUnknownEffect(listProviderSessionsExitJson)
export const encodeListProviderProjectsExit = Schema.encodeUnknownEffect(listProviderProjectsExitJson)
export const encodeImportProviderSessionExit = Schema.encodeUnknownEffect(importProviderSessionExitJson)
export const decodeEventsRequest = Schema.decodeUnknownEffect(EventsRequest)
export const decodeSnapshotRequest = Schema.decodeUnknownEffect(SnapshotRequest)
export const decodeGetProjectIndexRequest = Schema.decodeUnknownEffect(GetProjectIndexRequest)
export const decodeInvalidateProjectIndexRequest = Schema.decodeUnknownEffect(
	InvalidateProjectIndexRequest,
)
export const decodeReadTextFileRequest = Schema.decodeUnknownEffect(ReadTextFileRequest)
export const decodeWriteTextFileRequest = Schema.decodeUnknownEffect(WriteTextFileRequest)
export const decodeGetDefaultShellRequest = Schema.decodeUnknownEffect(GetDefaultShellRequest)
export const decodeGitCallRequest = Schema.decodeUnknownEffect(GitCallRequest)
export const decodeAgentCallRequest = Schema.decodeUnknownEffect(AgentCallRequest)
export const decodeGetProviderAccountUsageRequest = Schema.decodeUnknownEffect(
	GetProviderAccountUsageRequest,
)
export const decodeListProviderSessionsRequest = Schema.decodeUnknownEffect(ListProviderSessionsRequest)
export const decodeListProviderProjectsRequest = Schema.decodeUnknownEffect(ListProviderProjectsRequest)
export const decodeImportProviderSessionRequest = Schema.decodeUnknownEffect(
	ImportProviderSessionRequest,
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
	readonly readTextFile: (
		request: ReadTextFileRequest,
	) => Effect.Effect<string, RpcClientError, R>
	readonly writeTextFile: (
		request: WriteTextFileRequest,
	) => Effect.Effect<void, RpcClientError, R>
	readonly getDefaultShell: () => Effect.Effect<string, RpcClientError, R>
	readonly gitCall: (request: GitCallRequest) => Effect.Effect<GitCallResult, RpcClientError, R>
	readonly agentCall: (
		request: AgentCallRequest,
	) => Effect.Effect<AgentCallResult, RpcClientError, R>
	readonly getProviderAccountUsage: (
		request: GetProviderAccountUsageRequest,
	) => Effect.Effect<GetProviderAccountUsageResponse, RpcClientError, R>
	readonly listProviderSessions: (
		projectPath: TrimmedNonEmptyString,
	) => Effect.Effect<ReadonlyArray<DiscoveredProviderSession>, RpcClientError, R>
	readonly listProviderProjects: () => Effect.Effect<
		ReadonlyArray<DiscoveredProviderProject>,
		RpcClientError,
		R
	>
	readonly importProviderSession: (
		request: ImportProviderSessionRequest,
	) => Effect.Effect<ImportProviderSessionResult, RpcClientError, R>
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
	readTextFile: transport.readTextFile,
	writeTextFile: transport.writeTextFile,
	getDefaultShell: transport.getDefaultShell,
	gitCall: transport.gitCall,
	agentCall: transport.agentCall,
	getProviderAccountUsage: transport.getProviderAccountUsage,
	listProviderSessions: transport.listProviderSessions,
	listProviderProjects: transport.listProviderProjects,
	importProviderSession: transport.importProviderSession,
	events: (fromSequence) =>
		Stream.unwrap(
			Ref.make(fromSequence).pipe(Effect.map((cursor) => resumeEvents(transport, cursor))),
		),
})
