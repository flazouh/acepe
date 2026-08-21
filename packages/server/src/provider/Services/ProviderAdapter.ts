import {
	type OrchestrationEvent,
	MessageId,
	ProjectId,
	SessionId,
	TrimmedNonEmptyString,
	TurnId
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as Stream from "effect/Stream"

export const ProviderId = Schema.Trim.check(Schema.isNonEmpty()).pipe(Schema.brand("ProviderId"))
export type ProviderId = typeof ProviderId.Type
export const decodeProviderId = Schema.decodeUnknownEffect(ProviderId)

export const PROVIDER_CAPABILITY_NAMES = [
	"models",
	"modes",
	"commands",
	"configOptions",
	"autonomous",
	"plan",
	"compaction",
	"usage",
	"toolCalls",
	"permissionRequests"
] as const

export const ProviderCapabilityName = Schema.Literals(PROVIDER_CAPABILITY_NAMES)
export type ProviderCapabilityName = typeof ProviderCapabilityName.Type

export const ProviderCapabilities = Schema.Struct({
	enabled: Schema.Array(ProviderCapabilityName)
})
export type ProviderCapabilities = typeof ProviderCapabilities.Type

export const isCapabilityEnabled = (
	capabilities: ProviderCapabilities,
	name: ProviderCapabilityName
): boolean => Arr.contains(capabilities.enabled, name)

export const ProviderPresence = Schema.Struct({
	providerId: ProviderId,
	installed: Schema.Boolean,
	authenticated: Schema.Boolean
})
export type ProviderPresence = typeof ProviderPresence.Type

export const StartSessionRequest = Schema.Struct({
	sessionId: SessionId,
	projectId: ProjectId,
	workspaceRoot: TrimmedNonEmptyString
})
export type StartSessionRequest = typeof StartSessionRequest.Type

export const SendPromptRequest = Schema.Struct({
	sessionId: SessionId,
	messageId: MessageId,
	text: TrimmedNonEmptyString
})
export type SendPromptRequest = typeof SendPromptRequest.Type

export const CancelTurnRequest = Schema.Struct({
	sessionId: SessionId,
	turnId: Schema.optionalKey(TurnId)
})
export type CancelTurnRequest = typeof CancelTurnRequest.Type

export class ProviderAdapterError extends Schema.TaggedError<ProviderAdapterError>()(
	"ProviderAdapterError",
	{
		providerId: ProviderId,
		operation: Schema.Literals(["startSession", "sendPrompt", "cancelTurn"]),
		detail: Schema.String
	}
) {
	override get message(): string {
		return `Provider adapter '${this.providerId}' failed during ${this.operation}: ${this.detail}`
	}
}

export type ProviderAdapter = {
	readonly providerId: ProviderId
	readonly capabilities: ProviderCapabilities
	readonly presence: Effect.Effect<ProviderPresence>
	readonly startSession: (
		request: StartSessionRequest
	) => Stream.Stream<OrchestrationEvent, ProviderAdapterError>
	readonly sendPrompt: (
		request: SendPromptRequest
	) => Stream.Stream<OrchestrationEvent, ProviderAdapterError>
	readonly cancelTurn: (
		request: CancelTurnRequest
	) => Effect.Effect<void, ProviderAdapterError>
}
