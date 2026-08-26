import * as Match from "effect/Match"
import * as Schema from "effect/Schema"

import { type JsonObject, TrimmedNonEmptyString } from "./baseSchemas.ts"
import {
	ActivityId,
	AgentsId,
	ApprovalRequestId,
	CommandId,
	SessionId,
	ToolCallId,
	TurnId,
} from "./ids.ts"

export const APP_AGENTS_ID: AgentsId = AgentsId.make("app")

export const ApprovalDecision = Schema.Literals(["allow", "deny"])
export type ApprovalDecision = typeof ApprovalDecision.Type

export const ObservedToolStatus = Schema.Literals([
	"pending",
	"in_progress",
	"completed",
	"failed",
])
export type ObservedToolStatus = typeof ObservedToolStatus.Type

export const AgentListing = Schema.Struct({
	agentId: TrimmedNonEmptyString,
	installed: Schema.Boolean,
	authenticated: Schema.Boolean,
})
export type AgentListing = typeof AgentListing.Type

export const SessionResumeCommand = Schema.Struct({
	type: Schema.Literal("session.resume"),
	commandId: CommandId,
	sessionId: SessionId,
})
export type SessionResumeCommand = typeof SessionResumeCommand.Type

export const SessionForkCommand = Schema.Struct({
	type: Schema.Literal("session.fork"),
	commandId: CommandId,
	sessionId: SessionId,
	newSessionId: SessionId,
})
export type SessionForkCommand = typeof SessionForkCommand.Type

export const SessionCloseCommand = Schema.Struct({
	type: Schema.Literal("session.close"),
	commandId: CommandId,
	sessionId: SessionId,
})
export type SessionCloseCommand = typeof SessionCloseCommand.Type

export const SessionSetModelCommand = Schema.Struct({
	type: Schema.Literal("session.set-model"),
	commandId: CommandId,
	sessionId: SessionId,
	modelId: TrimmedNonEmptyString,
})
export type SessionSetModelCommand = typeof SessionSetModelCommand.Type

export const SessionSetModeCommand = Schema.Struct({
	type: Schema.Literal("session.set-mode"),
	commandId: CommandId,
	sessionId: SessionId,
	modeId: TrimmedNonEmptyString,
})
export type SessionSetModeCommand = typeof SessionSetModeCommand.Type

export const SessionSetAutonomousCommand = Schema.Struct({
	type: Schema.Literal("session.set-autonomous"),
	commandId: CommandId,
	sessionId: SessionId,
	autonomous: Schema.Boolean,
})
export type SessionSetAutonomousCommand = typeof SessionSetAutonomousCommand.Type

export const SessionSetConfigOptionCommand = Schema.Struct({
	type: Schema.Literal("session.set-config-option"),
	commandId: CommandId,
	sessionId: SessionId,
	key: TrimmedNonEmptyString,
	value: TrimmedNonEmptyString,
})
export type SessionSetConfigOptionCommand = typeof SessionSetConfigOptionCommand.Type

export const InteractionReplyCommand = Schema.Struct({
	type: Schema.Literal("interaction.reply"),
	commandId: CommandId,
	sessionId: SessionId,
	approvalRequestId: ApprovalRequestId,
	decision: ApprovalDecision,
})
export type InteractionReplyCommand = typeof InteractionReplyCommand.Type

export const InboundRespondCommand = Schema.Struct({
	type: Schema.Literal("inbound.respond"),
	commandId: CommandId,
	sessionId: SessionId,
	requestId: TrimmedNonEmptyString,
	body: TrimmedNonEmptyString,
})
export type InboundRespondCommand = typeof InboundRespondCommand.Type

export const AgentInitializeCommand = Schema.Struct({
	type: Schema.Literal("agent.initialize"),
	commandId: CommandId,
	agentId: TrimmedNonEmptyString,
})
export type AgentInitializeCommand = typeof AgentInitializeCommand.Type

export const AgentInstallCommand = Schema.Struct({
	type: Schema.Literal("agent.install"),
	commandId: CommandId,
	agentId: TrimmedNonEmptyString,
})
export type AgentInstallCommand = typeof AgentInstallCommand.Type

export const AgentUninstallCommand = Schema.Struct({
	type: Schema.Literal("agent.uninstall"),
	commandId: CommandId,
	agentId: TrimmedNonEmptyString,
})
export type AgentUninstallCommand = typeof AgentUninstallCommand.Type

export const AgentAuthenticateCommand = Schema.Struct({
	type: Schema.Literal("agent.authenticate"),
	commandId: CommandId,
	agentId: TrimmedNonEmptyString,
})
export type AgentAuthenticateCommand = typeof AgentAuthenticateCommand.Type

export const AgentCancelAuthenticationCommand = Schema.Struct({
	type: Schema.Literal("agent.cancel-authentication"),
	commandId: CommandId,
	agentId: TrimmedNonEmptyString,
})
export type AgentCancelAuthenticationCommand = typeof AgentCancelAuthenticationCommand.Type

export const AgentRegisterCustomCommand = Schema.Struct({
	type: Schema.Literal("agent.register-custom"),
	commandId: CommandId,
	agentId: TrimmedNonEmptyString,
	label: TrimmedNonEmptyString,
})
export type AgentRegisterCustomCommand = typeof AgentRegisterCustomCommand.Type

export const AgentListCommand = Schema.Struct({
	type: Schema.Literal("agent.list"),
	commandId: CommandId,
	agents: Schema.Array(AgentListing),
})
export type AgentListCommand = typeof AgentListCommand.Type

export const SessionConnectionRefreshCommand = Schema.Struct({
	type: Schema.Literal("session.connection.refresh"),
	commandId: CommandId,
	sessionId: SessionId,
	ready: Schema.Boolean,
})
export type SessionConnectionRefreshCommand = typeof SessionConnectionRefreshCommand.Type

export const SessionStateRefreshCommand = Schema.Struct({
	type: Schema.Literal("session.state.refresh"),
	commandId: CommandId,
	sessionId: SessionId,
	state: TrimmedNonEmptyString,
})
export type SessionStateRefreshCommand = typeof SessionStateRefreshCommand.Type

export const TranscriptPageReadCommand = Schema.Struct({
	type: Schema.Literal("transcript.page.read"),
	commandId: CommandId,
	sessionId: SessionId,
	cursor: TrimmedNonEmptyString,
})
export type TranscriptPageReadCommand = typeof TranscriptPageReadCommand.Type

export const TranscriptViewportRequestCommand = Schema.Struct({
	type: Schema.Literal("transcript.viewport.request"),
	commandId: CommandId,
	sessionId: SessionId,
	anchor: TrimmedNonEmptyString,
})
export type TranscriptViewportRequestCommand = typeof TranscriptViewportRequestCommand.Type

export const AgentPreconnectionCapabilitiesCommand = Schema.Struct({
	type: Schema.Literal("agent.preconnection.capabilities"),
	commandId: CommandId,
	agentId: TrimmedNonEmptyString,
	capabilities: Schema.Array(TrimmedNonEmptyString),
})
export type AgentPreconnectionCapabilitiesCommand =
	typeof AgentPreconnectionCapabilitiesCommand.Type

export const AgentPreconnectionCommandsCommand = Schema.Struct({
	type: Schema.Literal("agent.preconnection.commands"),
	commandId: CommandId,
	agentId: TrimmedNonEmptyString,
	commands: Schema.Array(TrimmedNonEmptyString),
})
export type AgentPreconnectionCommandsCommand = typeof AgentPreconnectionCommandsCommand.Type

export const ComposerMcpCatalogCommand = Schema.Struct({
	type: Schema.Literal("composer.mcp.catalog"),
	commandId: CommandId,
	entries: Schema.Array(TrimmedNonEmptyString),
})
export type ComposerMcpCatalogCommand = typeof ComposerMcpCatalogCommand.Type

export const AgentComputerUseProbeCommand = Schema.Struct({
	type: Schema.Literal("agent.computer-use.probe"),
	commandId: CommandId,
	available: Schema.Boolean,
})
export type AgentComputerUseProbeCommand = typeof AgentComputerUseProbeCommand.Type

export const AgentEventBridgeRefreshCommand = Schema.Struct({
	type: Schema.Literal("agent.event-bridge.refresh"),
	commandId: CommandId,
	connected: Schema.Boolean,
})
export type AgentEventBridgeRefreshCommand = typeof AgentEventBridgeRefreshCommand.Type

export const ToolCallObserveCommand = Schema.Struct({
	type: Schema.Literal("tool.call.observe"),
	commandId: CommandId,
	sessionId: SessionId,
	activityId: ActivityId,
	toolCallId: ToolCallId,
	operationId: Schema.NullOr(TrimmedNonEmptyString),
	status: ObservedToolStatus,
	title: TrimmedNonEmptyString,
	path: Schema.NullOr(TrimmedNonEmptyString),
	// Required and nullable, unlike the event payload's optional key: a
	// command is dispatched, never replayed from storage, so there is no old
	// shape to keep decoding. See ToolCallObservedPayload's output below.
	output: Schema.NullOr(TrimmedNonEmptyString),
})
export type ToolCallObserveCommand = typeof ToolCallObserveCommand.Type

export const ApprovalRequestCommand = Schema.Struct({
	type: Schema.Literal("approval.request"),
	commandId: CommandId,
	sessionId: SessionId,
	approvalRequestId: ApprovalRequestId,
	title: TrimmedNonEmptyString,
})
export type ApprovalRequestCommand = typeof ApprovalRequestCommand.Type

export const AcpCommand = Schema.Union([
	SessionResumeCommand,
	SessionForkCommand,
	SessionCloseCommand,
	SessionSetModelCommand,
	SessionSetModeCommand,
	SessionSetAutonomousCommand,
	SessionSetConfigOptionCommand,
	InteractionReplyCommand,
	InboundRespondCommand,
	AgentInitializeCommand,
	AgentInstallCommand,
	AgentUninstallCommand,
	AgentAuthenticateCommand,
	AgentCancelAuthenticationCommand,
	AgentRegisterCustomCommand,
	AgentListCommand,
	SessionConnectionRefreshCommand,
	SessionStateRefreshCommand,
	TranscriptPageReadCommand,
	TranscriptViewportRequestCommand,
	AgentPreconnectionCapabilitiesCommand,
	AgentPreconnectionCommandsCommand,
	ComposerMcpCatalogCommand,
	AgentComputerUseProbeCommand,
	AgentEventBridgeRefreshCommand,
	ToolCallObserveCommand,
	ApprovalRequestCommand,
])
export type AcpCommand = typeof AcpCommand.Type

export const SessionResumedPayload = Schema.Struct({
	sessionId: SessionId,
})
export type SessionResumedPayload = typeof SessionResumedPayload.Type

export const SessionForkedPayload = Schema.Struct({
	sessionId: SessionId,
	newSessionId: SessionId,
})
export type SessionForkedPayload = typeof SessionForkedPayload.Type

export const SessionClosedPayload = Schema.Struct({
	sessionId: SessionId,
})
export type SessionClosedPayload = typeof SessionClosedPayload.Type

export const SessionModelSetPayload = Schema.Struct({
	sessionId: SessionId,
	modelId: TrimmedNonEmptyString,
})
export type SessionModelSetPayload = typeof SessionModelSetPayload.Type

export const SessionModeSetPayload = Schema.Struct({
	sessionId: SessionId,
	modeId: TrimmedNonEmptyString,
})
export type SessionModeSetPayload = typeof SessionModeSetPayload.Type

export const SessionAutonomousSetPayload = Schema.Struct({
	sessionId: SessionId,
	autonomous: Schema.Boolean,
})
export type SessionAutonomousSetPayload = typeof SessionAutonomousSetPayload.Type

export const SessionConfigOptionSetPayload = Schema.Struct({
	sessionId: SessionId,
	key: TrimmedNonEmptyString,
	value: TrimmedNonEmptyString,
})
export type SessionConfigOptionSetPayload = typeof SessionConfigOptionSetPayload.Type

export const InteractionRepliedPayload = Schema.Struct({
	sessionId: SessionId,
	approvalRequestId: ApprovalRequestId,
	decision: ApprovalDecision,
})
export type InteractionRepliedPayload = typeof InteractionRepliedPayload.Type

export const InboundRespondedPayload = Schema.Struct({
	sessionId: SessionId,
	requestId: TrimmedNonEmptyString,
	body: TrimmedNonEmptyString,
})
export type InboundRespondedPayload = typeof InboundRespondedPayload.Type

export const AgentInitializedPayload = Schema.Struct({
	agentId: TrimmedNonEmptyString,
})
export type AgentInitializedPayload = typeof AgentInitializedPayload.Type

export const AgentInstalledPayload = Schema.Struct({
	agentId: TrimmedNonEmptyString,
})
export type AgentInstalledPayload = typeof AgentInstalledPayload.Type

export const AgentUninstalledPayload = Schema.Struct({
	agentId: TrimmedNonEmptyString,
})
export type AgentUninstalledPayload = typeof AgentUninstalledPayload.Type

export const AgentAuthenticatedPayload = Schema.Struct({
	agentId: TrimmedNonEmptyString,
})
export type AgentAuthenticatedPayload = typeof AgentAuthenticatedPayload.Type

export const AgentAuthenticationCancelledPayload = Schema.Struct({
	agentId: TrimmedNonEmptyString,
})
export type AgentAuthenticationCancelledPayload = typeof AgentAuthenticationCancelledPayload.Type

export const AgentCustomRegisteredPayload = Schema.Struct({
	agentId: TrimmedNonEmptyString,
	label: TrimmedNonEmptyString,
})
export type AgentCustomRegisteredPayload = typeof AgentCustomRegisteredPayload.Type

export const AgentsListedPayload = Schema.Struct({
	agents: Schema.Array(AgentListing),
})
export type AgentsListedPayload = typeof AgentsListedPayload.Type

export const SessionConnectionRefreshedPayload = Schema.Struct({
	sessionId: SessionId,
	ready: Schema.Boolean,
})
export type SessionConnectionRefreshedPayload = typeof SessionConnectionRefreshedPayload.Type

export const SessionStateRefreshedPayload = Schema.Struct({
	sessionId: SessionId,
	state: TrimmedNonEmptyString,
})
export type SessionStateRefreshedPayload = typeof SessionStateRefreshedPayload.Type

export const TranscriptPageReadPayload = Schema.Struct({
	sessionId: SessionId,
	cursor: TrimmedNonEmptyString,
})
export type TranscriptPageReadPayload = typeof TranscriptPageReadPayload.Type

export const TranscriptViewportRequestedPayload = Schema.Struct({
	sessionId: SessionId,
	anchor: TrimmedNonEmptyString,
})
export type TranscriptViewportRequestedPayload = typeof TranscriptViewportRequestedPayload.Type

export const PreconnectionCapabilitiesListedPayload = Schema.Struct({
	agentId: TrimmedNonEmptyString,
	capabilities: Schema.Array(TrimmedNonEmptyString),
})
export type PreconnectionCapabilitiesListedPayload =
	typeof PreconnectionCapabilitiesListedPayload.Type

export const PreconnectionCommandsListedPayload = Schema.Struct({
	agentId: TrimmedNonEmptyString,
	commands: Schema.Array(TrimmedNonEmptyString),
})
export type PreconnectionCommandsListedPayload = typeof PreconnectionCommandsListedPayload.Type

export const ComposerMcpCatalogLoadedPayload = Schema.Struct({
	entries: Schema.Array(TrimmedNonEmptyString),
})
export type ComposerMcpCatalogLoadedPayload = typeof ComposerMcpCatalogLoadedPayload.Type

export const ComputerUseProbedPayload = Schema.Struct({
	available: Schema.Boolean,
})
export type ComputerUseProbedPayload = typeof ComputerUseProbedPayload.Type

export const EventBridgeRefreshedPayload = Schema.Struct({
	connected: Schema.Boolean,
})
export type EventBridgeRefreshedPayload = typeof EventBridgeRefreshedPayload.Type

// #273: a tool call's result is canonical product truth, the same way its
// status and title are. Every provider that parses one used to drop it at the
// publish boundary, so no projection and no client had anywhere to read a tool
// result from. It travels on the observation itself.
//
// The key is optional for ONE reason: replay. Events appended before this
// field existed carry no output key, and the activities projector re-decodes
// every stored payload on a rebuild (see ProjectionSessionActivities.ts's
// projectToolCallObserved), so a required key would fail an old event instead
// of projecting it. Every event minted from here on carries the key -- null
// when the provider has reported no output yet, which a tool call's start
// event never does and its completion event does.
//
// TOOL_OUTPUT_CAP bounds the text the way TERMINAL_OUTPUT_CAP bounds a
// terminal's (see terminal.ts). The event log is append-only, so one
// unbounded file-read result would stay in it for the life of the database.
// It keeps the head, not the tail: a result reads from its start.
export const TOOL_OUTPUT_CAP = 64_000

// The one place a provider's raw output string becomes the canonical field:
// blank is absent (every provider sends "" for a field it has no value for --
// same rule as Json.ts's stringField), and the ends are trimmed because
// TrimmedNonEmptyString rejects what trims to nothing.
export const observedToolOutput = (output: string | null): string | null => {
	if (output === null) {
		return null
	}
	const trimmed = output.trim()
	if (trimmed.length === 0) {
		return null
	}
	if (trimmed.length <= TOOL_OUTPUT_CAP) {
		return trimmed
	}
	return trimmed.slice(0, TOOL_OUTPUT_CAP)
}

// The one place a provider's raw tool-kind string becomes the canonical
// field: blank is absent (same rule as observedToolOutput), and the ends are
// trimmed because TrimmedNonEmptyString rejects what trims to nothing, which
// would make ToolCallObservedEvent.make throw and kill the adapter's fiber.
export const observedToolKind = (kind: string | null): string | null => {
	if (kind === null) {
		return null
	}
	const trimmed = kind.trim()
	return trimmed.length === 0 ? null : trimmed
}

export const ToolCallObservedPayload = Schema.Struct({
	sessionId: SessionId,
	activityId: ActivityId,
	toolCallId: ToolCallId,
	operationId: Schema.NullOr(TrimmedNonEmptyString),
	status: ObservedToolStatus,
	title: TrimmedNonEmptyString,
	path: Schema.NullOr(TrimmedNonEmptyString),
	output: TrimmedNonEmptyString.pipe(Schema.NullOr, Schema.optionalKey),
	// The provider's own tool classification (e.g. "edit", "execute",
	// "read"). It is canonical product truth the same way status and title
	// are: every provider computes it to build the title/path hints, then
	// used to drop it here, so the client had nothing to read and fell back
	// to re-parsing the display title, which failed for path-bearing titles
	// like "Write /abs/path" (AC-280). Optional and nullable for the same
	// replay reason as `output`: events appended before this field existed
	// carry no kind key, and the activities projector re-decodes every stored
	// payload on a rebuild. Null when a provider has not classified the call.
	kind: TrimmedNonEmptyString.pipe(Schema.NullOr, Schema.optionalKey),
})
export type ToolCallObservedPayload = typeof ToolCallObservedPayload.Type

export const ApprovalRequestedPayload = Schema.Struct({
	sessionId: SessionId,
	approvalRequestId: ApprovalRequestId,
	title: TrimmedNonEmptyString,
})
export type ApprovalRequestedPayload = typeof ApprovalRequestedPayload.Type

// AC-269: a provider's usage_update/usage-bearing message used to fall into
// the generic SessionMetaUpdated metadata branch (same swallow pattern
// #262/#263 already fixed for provider_session/tool calls) -- no projector
// reads SessionMetaUpdated's metadata for usage, so nothing downstream could
// show the Claude Code working line's live token count. turnId is optional
// because an adapter may not always be able to resolve which turn a usage
// reading belongs to (mirrors TurnCompletedPayload/TurnCancelledPayload).
export const TurnUsageObservedPayload = Schema.Struct({
	sessionId: SessionId,
	turnId: Schema.optionalKey(TurnId),
	// #274: the provider's own deterministic id for this one reading, which
	// the desktop dedups on -- canonical-usage-telemetry.ts drops a reading
	// whose id matches lastTelemetryEventId, so a redelivered or replayed
	// reading stops double-counting the turn's spend. Codex derives one in its
	// Map.ts from the thread, the turn and every token figure, and publishes it
	// here. Copilot derives one the same way but has no usage publisher at all
	// yet (its Adapter.ts folds every fact into SessionMetaUpdated), so its id
	// still stops at the fact. Optional and nullable for the same replay reason as
	// ToolCallObservedPayload's output above: events appended before this field
	// existed carry no key. Null when a provider has no id for the reading, in
	// which case the desktop simply applies it.
	eventId: TrimmedNonEmptyString.pipe(Schema.NullOr, Schema.optionalKey),
	inputTokens: Schema.optionalKey(Schema.Number),
	outputTokens: Schema.optionalKey(Schema.Number),
	totalTokens: Schema.optionalKey(Schema.Number),
	cacheReadTokens: Schema.optionalKey(Schema.Number),
	cacheWriteTokens: Schema.optionalKey(Schema.Number),
	costUsd: Schema.optionalKey(Schema.Number),
	contextWindowSize: Schema.optionalKey(Schema.Number),
})
export type TurnUsageObservedPayload = typeof TurnUsageObservedPayload.Type

export const ACP_SESSION_COMMAND_TYPES = [
	"session.create",
	"session.meta.update",
	"session.archive",
	"session.unarchive",
	"session.delete",
	"message.send",
	"token.append",
	"turn.cancel",
	"session.resume",
	"session.fork",
	"session.close",
	"session.set-model",
	"session.set-mode",
	"session.set-autonomous",
	"session.set-config-option",
	"interaction.reply",
	"inbound.respond",
	"agent.initialize",
	"agent.install",
	"agent.uninstall",
	"agent.authenticate",
	"agent.cancel-authentication",
	"agent.register-custom",
	"agent.list",
	"session.connection.refresh",
	"session.state.refresh",
	"transcript.page.read",
	"transcript.viewport.request",
	"agent.preconnection.capabilities",
	"agent.preconnection.commands",
	"composer.mcp.catalog",
	"agent.computer-use.probe",
	"agent.event-bridge.refresh",
] as const

export type AcpSessionCommandType = (typeof ACP_SESSION_COMMAND_TYPES)[number]

// The approval lifecycle also travels out of band, as one reserved key on an
// event's metadata, for the moment a native ApprovalRequested or
// InteractionReplied event cannot carry: a provider adapter answering an
// approval nobody asked it to answer, which is a drained, abandoned
// permission — see each provider's Permissions.ts. Both the producer (the
// provider layer) and the consumer (ProjectionPendingApprovals in
// packages/server) read this one definition, so the key and the payload shape
// can never drift apart across the layer boundary.
export const ApprovalRequestedFact = Schema.Struct({
	type: Schema.Literal("ApprovalRequested"),
	approvalRequestId: ApprovalRequestId,
	sessionId: SessionId,
})
export type ApprovalRequestedFact = typeof ApprovalRequestedFact.Type

export const ApprovalAnsweredFact = Schema.Struct({
	type: Schema.Literal("ApprovalAnswered"),
	approvalRequestId: ApprovalRequestId,
	sessionId: SessionId,
	decision: ApprovalDecision,
})
export type ApprovalAnsweredFact = typeof ApprovalAnsweredFact.Type

export const PendingApprovalFact = Schema.Union([ApprovalRequestedFact, ApprovalAnsweredFact])
export type PendingApprovalFact = typeof PendingApprovalFact.Type

export const PENDING_APPROVAL_METADATA_KEY = "pendingApproval"

export const pendingApprovalMetadata = (fact: PendingApprovalFact): JsonObject =>
	Match.value(fact).pipe(
		Match.discriminatorsExhaustive("type")({
			ApprovalRequested: (requested) => ({
				[PENDING_APPROVAL_METADATA_KEY]: {
					type: requested.type,
					approvalRequestId: requested.approvalRequestId,
					sessionId: requested.sessionId,
				},
			}),
			ApprovalAnswered: (answered) => ({
				[PENDING_APPROVAL_METADATA_KEY]: {
					type: answered.type,
					approvalRequestId: answered.approvalRequestId,
					sessionId: answered.sessionId,
					decision: answered.decision,
				},
			}),
		}),
	)
