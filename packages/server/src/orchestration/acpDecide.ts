import {
	APP_AGENTS_ID,
	type AcpCommand,
	type AgentAuthenticatedEvent,
	type AgentAuthenticationCancelledEvent,
	type AgentCustomRegisteredEvent,
	type AgentInitializedEvent,
	type AgentInstalledEvent,
	type AgentUninstalledEvent,
	type AgentsListedEvent,
	type ApprovalRequestedEvent,
	type ComposerMcpCatalogLoadedEvent,
	type ComputerUseProbedEvent,
	type EventBridgeRefreshedEvent,
	type EventId,
	type InboundRespondedEvent,
	type InteractionRepliedEvent,
	type IsoDateTime,
	type JsonObject,
	type OrchestrationEvent,
	type PreconnectionCapabilitiesListedEvent,
	type PreconnectionCommandsListedEvent,
	type Sequence,
	type SessionAutonomousSetEvent,
	type SessionClosedEvent,
	type SessionConfigOptionSetEvent,
	type SessionConnectionRefreshedEvent,
	type SessionForkedEvent,
	type SessionModelSetEvent,
	type SessionModeSetEvent,
	type SessionResumedEvent,
	type SessionStateRefreshedEvent,
	type ToolCallObservedEvent,
	type TranscriptPageReadEvent,
	type TranscriptViewportRequestedEvent
} from "@acepe/contracts"
import * as Effect from "effect/Effect"
import { requireSession, type OrchestrationReadModel } from "./commandInvariants.ts"
import type { OrchestrationCommandInvariantError } from "./Errors.ts"

type AcpDecideIdentity = {
	readonly eventId: EventId
	readonly occurredAt: IsoDateTime
}

const EMPTY_METADATA: JsonObject = {}

const nextSequence = (snapshotSequence: Sequence): Sequence => snapshotSequence + 1

const sessionEvent = <Type extends string, Payload>(
	command: { readonly commandId: OrchestrationEvent["commandId"]; readonly sessionId: SessionResumedEvent["aggregateId"] },
	identity: AcpDecideIdentity,
	sequence: Sequence,
	type: Type,
	payload: Payload
) => ({
	sequence,
	eventId: identity.eventId,
	aggregateKind: "session" as const,
	aggregateId: command.sessionId,
	occurredAt: identity.occurredAt,
	commandId: command.commandId,
	causationEventId: null,
	correlationId: command.commandId,
	metadata: EMPTY_METADATA,
	type,
	payload
})

const agentEvent = <Type extends string, Payload>(
	command: { readonly commandId: OrchestrationEvent["commandId"] },
	identity: AcpDecideIdentity,
	sequence: Sequence,
	type: Type,
	payload: Payload
) => ({
	sequence,
	eventId: identity.eventId,
	aggregateKind: "agent" as const,
	aggregateId: APP_AGENTS_ID,
	occurredAt: identity.occurredAt,
	commandId: command.commandId,
	causationEventId: null,
	correlationId: command.commandId,
	metadata: EMPTY_METADATA,
	type,
	payload
})

export const decideAcp = Effect.fn("decideAcp")(function*(
	readModel: OrchestrationReadModel,
	command: AcpCommand,
	identity: AcpDecideIdentity
): Effect.fn.Return<ReadonlyArray<OrchestrationEvent>, OrchestrationCommandInvariantError> {
	const sequence = nextSequence(readModel.snapshotSequence)
	switch (command.type) {
		case "session.resume": {
			yield* requireSession({ readModel, command, sessionId: command.sessionId })
			const event: SessionResumedEvent = sessionEvent(command, identity, sequence, "SessionResumed", {
				sessionId: command.sessionId
			})
			return [event]
		}
		case "session.fork": {
			yield* requireSession({ readModel, command, sessionId: command.sessionId })
			const event: SessionForkedEvent = sessionEvent(command, identity, sequence, "SessionForked", {
				sessionId: command.sessionId,
				newSessionId: command.newSessionId
			})
			return [event]
		}
		case "session.close": {
			yield* requireSession({ readModel, command, sessionId: command.sessionId })
			const event: SessionClosedEvent = sessionEvent(command, identity, sequence, "SessionClosed", {
				sessionId: command.sessionId
			})
			return [event]
		}
		case "session.set-model": {
			yield* requireSession({ readModel, command, sessionId: command.sessionId })
			const event: SessionModelSetEvent = sessionEvent(command, identity, sequence, "SessionModelSet", {
				sessionId: command.sessionId,
				modelId: command.modelId
			})
			return [event]
		}
		case "session.set-mode": {
			yield* requireSession({ readModel, command, sessionId: command.sessionId })
			const event: SessionModeSetEvent = sessionEvent(command, identity, sequence, "SessionModeSet", {
				sessionId: command.sessionId,
				modeId: command.modeId
			})
			return [event]
		}
		case "session.set-autonomous": {
			yield* requireSession({ readModel, command, sessionId: command.sessionId })
			const event: SessionAutonomousSetEvent = sessionEvent(
				command,
				identity,
				sequence,
				"SessionAutonomousSet",
				{
					sessionId: command.sessionId,
					autonomous: command.autonomous
				}
			)
			return [event]
		}
		case "session.set-config-option": {
			yield* requireSession({ readModel, command, sessionId: command.sessionId })
			const event: SessionConfigOptionSetEvent = sessionEvent(
				command,
				identity,
				sequence,
				"SessionConfigOptionSet",
				{
					sessionId: command.sessionId,
					key: command.key,
					value: command.value
				}
			)
			return [event]
		}
		case "interaction.reply": {
			yield* requireSession({ readModel, command, sessionId: command.sessionId })
			const event: InteractionRepliedEvent = sessionEvent(
				command,
				identity,
				sequence,
				"InteractionReplied",
				{
					sessionId: command.sessionId,
					approvalRequestId: command.approvalRequestId,
					decision: command.decision
				}
			)
			return [event]
		}
		case "inbound.respond": {
			yield* requireSession({ readModel, command, sessionId: command.sessionId })
			const event: InboundRespondedEvent = sessionEvent(command, identity, sequence, "InboundResponded", {
				sessionId: command.sessionId,
				requestId: command.requestId,
				body: command.body
			})
			return [event]
		}
		case "agent.initialize": {
			const event: AgentInitializedEvent = agentEvent(command, identity, sequence, "AgentInitialized", {
				agentId: command.agentId
			})
			return [event]
		}
		case "agent.install": {
			const event: AgentInstalledEvent = agentEvent(command, identity, sequence, "AgentInstalled", {
				agentId: command.agentId
			})
			return [event]
		}
		case "agent.uninstall": {
			const event: AgentUninstalledEvent = agentEvent(command, identity, sequence, "AgentUninstalled", {
				agentId: command.agentId
			})
			return [event]
		}
		case "agent.authenticate": {
			const event: AgentAuthenticatedEvent = agentEvent(command, identity, sequence, "AgentAuthenticated", {
				agentId: command.agentId
			})
			return [event]
		}
		case "agent.cancel-authentication": {
			const event: AgentAuthenticationCancelledEvent = agentEvent(
				command,
				identity,
				sequence,
				"AgentAuthenticationCancelled",
				{
					agentId: command.agentId
				}
			)
			return [event]
		}
		case "agent.register-custom": {
			const event: AgentCustomRegisteredEvent = agentEvent(
				command,
				identity,
				sequence,
				"AgentCustomRegistered",
				{
					agentId: command.agentId,
					label: command.label
				}
			)
			return [event]
		}
		case "agent.list": {
			const event: AgentsListedEvent = agentEvent(command, identity, sequence, "AgentsListed", {
				agents: command.agents
			})
			return [event]
		}
		case "session.connection.refresh": {
			yield* requireSession({ readModel, command, sessionId: command.sessionId })
			const event: SessionConnectionRefreshedEvent = sessionEvent(
				command,
				identity,
				sequence,
				"SessionConnectionRefreshed",
				{
					sessionId: command.sessionId,
					ready: command.ready
				}
			)
			return [event]
		}
		case "session.state.refresh": {
			yield* requireSession({ readModel, command, sessionId: command.sessionId })
			const event: SessionStateRefreshedEvent = sessionEvent(
				command,
				identity,
				sequence,
				"SessionStateRefreshed",
				{
					sessionId: command.sessionId,
					state: command.state
				}
			)
			return [event]
		}
		case "transcript.page.read": {
			yield* requireSession({ readModel, command, sessionId: command.sessionId })
			const event: TranscriptPageReadEvent = sessionEvent(
				command,
				identity,
				sequence,
				"TranscriptPageRead",
				{
					sessionId: command.sessionId,
					cursor: command.cursor
				}
			)
			return [event]
		}
		case "transcript.viewport.request": {
			yield* requireSession({ readModel, command, sessionId: command.sessionId })
			const event: TranscriptViewportRequestedEvent = sessionEvent(
				command,
				identity,
				sequence,
				"TranscriptViewportRequested",
				{
					sessionId: command.sessionId,
					anchor: command.anchor
				}
			)
			return [event]
		}
		case "agent.preconnection.capabilities": {
			const event: PreconnectionCapabilitiesListedEvent = agentEvent(
				command,
				identity,
				sequence,
				"PreconnectionCapabilitiesListed",
				{
					agentId: command.agentId,
					capabilities: command.capabilities
				}
			)
			return [event]
		}
		case "agent.preconnection.commands": {
			const event: PreconnectionCommandsListedEvent = agentEvent(
				command,
				identity,
				sequence,
				"PreconnectionCommandsListed",
				{
					agentId: command.agentId,
					commands: command.commands
				}
			)
			return [event]
		}
		case "composer.mcp.catalog": {
			const event: ComposerMcpCatalogLoadedEvent = agentEvent(
				command,
				identity,
				sequence,
				"ComposerMcpCatalogLoaded",
				{
					entries: command.entries
				}
			)
			return [event]
		}
		case "agent.computer-use.probe": {
			const event: ComputerUseProbedEvent = agentEvent(command, identity, sequence, "ComputerUseProbed", {
				available: command.available
			})
			return [event]
		}
		case "agent.event-bridge.refresh": {
			const event: EventBridgeRefreshedEvent = agentEvent(
				command,
				identity,
				sequence,
				"EventBridgeRefreshed",
				{
					connected: command.connected
				}
			)
			return [event]
		}
		case "tool.call.observe": {
			yield* requireSession({ readModel, command, sessionId: command.sessionId })
			const event: ToolCallObservedEvent = sessionEvent(command, identity, sequence, "ToolCallObserved", {
				sessionId: command.sessionId,
				activityId: command.activityId,
				toolCallId: command.toolCallId,
				operationId: command.operationId,
				status: command.status,
				title: command.title,
				path: command.path
			})
			return [event]
		}
		case "approval.request": {
			yield* requireSession({ readModel, command, sessionId: command.sessionId })
			const event: ApprovalRequestedEvent = sessionEvent(
				command,
				identity,
				sequence,
				"ApprovalRequested",
				{
					sessionId: command.sessionId,
					approvalRequestId: command.approvalRequestId,
					title: command.title
				}
			)
			return [event]
		}
	}
})
