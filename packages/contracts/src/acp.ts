import * as Schema from "effect/Schema"

import { TrimmedNonEmptyString } from "./baseSchemas.ts"
import {
	ActivityId,
	AgentsId,
	ApprovalRequestId,
	CommandId,
	SessionId,
	ToolCallId,
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

export const ToolCallObservedPayload = Schema.Struct({
	sessionId: SessionId,
	activityId: ActivityId,
	toolCallId: ToolCallId,
	operationId: Schema.NullOr(TrimmedNonEmptyString),
	status: ObservedToolStatus,
	title: TrimmedNonEmptyString,
	path: Schema.NullOr(TrimmedNonEmptyString),
})
export type ToolCallObservedPayload = typeof ToolCallObservedPayload.Type

export const ApprovalRequestedPayload = Schema.Struct({
	sessionId: SessionId,
	approvalRequestId: ApprovalRequestId,
	title: TrimmedNonEmptyString,
})
export type ApprovalRequestedPayload = typeof ApprovalRequestedPayload.Type

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
