import * as Arr from "effect/Array"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import {
	type AgentJson,
	binaryTargetForPlatform,
	findAgentJson,
	type PlatformKey
} from "../agentJson.ts"
import {
	ProviderCapabilities,
	ProviderId,
	type ProviderPresence
} from "../Services/ProviderAdapter.ts"

export const CURSOR_PROVIDER_ID: ProviderId = ProviderId.make("cursor")

export const CURSOR_REGISTRY_AGENT_ID = "cursor"

export const CURSOR_CAPABILITIES: ProviderCapabilities = ProviderCapabilities.make({
	enabled: ["models", "modes", "commands", "plan", "toolCalls", "permissionRequests"]
})

export const CURSOR_MODES = ["agent", "ask"] as const
export type CursorMode = (typeof CURSOR_MODES)[number]

export type CursorLaunchPlan = {
	readonly cmd: string
	readonly args: ReadonlyArray<string>
}

export const cursorPresence = (installed: boolean, authenticated: boolean): ProviderPresence => ({
	providerId: CURSOR_PROVIDER_ID,
	installed,
	authenticated
})

export const launchFromAgentJson = (
	agent: AgentJson,
	platform: PlatformKey
): Option.Option<CursorLaunchPlan> => {
	const target = binaryTargetForPlatform(agent, platform)
	if (Option.isNone(target)) {
		return Option.none()
	}
	const args = target.value.args === undefined ? Arr.empty<string>() : target.value.args
	return Option.some({
		cmd: target.value.cmd,
		args
	})
}

export const cursorLaunchFromAgents = (
	agents: ReadonlyArray<AgentJson>,
	platform: PlatformKey
): Option.Option<CursorLaunchPlan> => {
	const found = findAgentJson(agents, Arr.empty(), CURSOR_PROVIDER_ID)
	if (Option.isNone(found)) {
		return Option.none()
	}
	return launchFromAgentJson(found.value.agent, platform)
}

export const probeCursorAuthenticated = Effect.fn("probeCursorAuthenticated")(function*() {
	const apiKey = yield* Config.option(Config.nonEmptyString("CURSOR_API_KEY"))
	const authToken = yield* Config.option(Config.nonEmptyString("CURSOR_AUTH_TOKEN"))
	return Option.isSome(apiKey) || Option.isSome(authToken)
})
