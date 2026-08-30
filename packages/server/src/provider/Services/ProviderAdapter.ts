import {
	AgentEnvOverrides,
	type OrchestrationEvent,
	MessageId,
	ProjectId,
	ProviderOperation,
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
	workspaceRoot: TrimmedNonEmptyString,
	// The per-agent environment a person configured in settings, resolved
	// ONCE by ProviderBridge and handed down here, so no adapter reads the
	// setting for itself. Every adapter merges it onto the environment its
	// child process already inherits; an override with the same name wins.
	// These are credentials — see provider/AgentEnv.ts for the rules that
	// keep them out of logs, errors and events.
	envOverrides: AgentEnvOverrides
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

// Carries a canonical SessionModeSet through to an adapter. Deliberately NOT
// a member of ProviderAdapter below: a provider whose transport has no mode
// mechanism must be able to declare the capability absent by simply not
// exposing setMode, the same way respondToPermission/shutdown work — a
// method no transport call backs is the dead code that made mode
// unreachable in the first place (issue #272). ProviderBridge detects it
// structurally; see supportsSetMode there.
export const SetModeRequest = Schema.Struct({
	sessionId: SessionId,
	modeId: TrimmedNonEmptyString
})
export type SetModeRequest = typeof SetModeRequest.Type

// Carries a canonical SessionModelSet through to an adapter, and NOT a member
// of ProviderAdapter for exactly the reason SetModeRequest is not: a provider
// whose transport cannot switch model declares that by exposing no setModel.
// Until this existed the bridge had no way to reach a provider with a chosen
// model at all, so picking one in the composer changed nothing about the turn
// that followed. See supportsSetModel in Layers/ProviderBridge.ts.
export const SetModelRequest = Schema.Struct({
	sessionId: SessionId,
	modelId: TrimmedNonEmptyString
})
export type SetModelRequest = typeof SetModelRequest.Type

export class ProviderAdapterError extends Schema.TaggedError<ProviderAdapterError>()(
	"ProviderAdapterError",
	{
		providerId: ProviderId,
		operation: ProviderOperation,
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
