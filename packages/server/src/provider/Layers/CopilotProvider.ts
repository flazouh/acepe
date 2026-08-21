import * as Arr from "effect/Array"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Str from "effect/String"
import {
	isCapabilityEnabled,
	ProviderCapabilities,
	ProviderId,
	type ProviderPresence
} from "../Services/ProviderAdapter.ts"

export const COPILOT_PROVIDER_ID: ProviderId = ProviderId.make("copilot")

export const COPILOT_TRANSPORT = "acp" as const

export const COPILOT_ACP_STDIO_ARGS = ["--acp", "--stdio"] as const

export const COPILOT_LOGIN_METHOD_ID = "copilot-login"

export const COPILOT_CAPABILITIES: ProviderCapabilities = ProviderCapabilities.make({
	enabled: [
		"models",
		"modes",
		"commands",
		"configOptions",
		"autonomous",
		"plan",
		"usage",
		"toolCalls",
		"permissionRequests"
	]
})

export const COPILOT_MODES = ["agent", "autopilot", "plan"] as const
export type CopilotMode = (typeof COPILOT_MODES)[number]

const COPILOT_MODE_AGENT_URI = "https://agentclientprotocol.com/protocol/session-modes#agent"
const COPILOT_MODE_PLAN_URI = "https://agentclientprotocol.com/protocol/session-modes#plan"
const COPILOT_MODE_AUTOPILOT_URI = "https://agentclientprotocol.com/protocol/session-modes#autopilot"
const LEGACY_COPILOT_MODE_AGENT_URI = "https://github.com/github/copilot-cli/mode#agent"
const LEGACY_COPILOT_MODE_PLAN_URI = "https://github.com/github/copilot-cli/mode#plan"
const LEGACY_COPILOT_MODE_AUTOPILOT_URI = "https://github.com/github/copilot-cli/mode#autopilot"

export const COPILOT_SESSION_MCP_SERVERS: ReadonlyArray<never> = Arr.empty()

export const copilotSessionNewParams = (
	cwd: string
): { readonly cwd: string; readonly mcpServers: ReadonlyArray<never> } => ({
	cwd,
	mcpServers: COPILOT_SESSION_MCP_SERVERS
})

export const copilotAuthenticateParams = {
	methodId: COPILOT_LOGIN_METHOD_ID
} as const

export const normalizeCopilotModeId = (id: string): string => {
	if (id === COPILOT_MODE_AGENT_URI || id === LEGACY_COPILOT_MODE_AGENT_URI || id === "build") {
		return "agent"
	}
	if (id === COPILOT_MODE_AUTOPILOT_URI || id === LEGACY_COPILOT_MODE_AUTOPILOT_URI) {
		return "autopilot"
	}
	if (id === COPILOT_MODE_PLAN_URI || id === LEGACY_COPILOT_MODE_PLAN_URI) {
		return "plan"
	}
	return id
}

export const mapOutboundCopilotModeId = (id: string): string => {
	if (id === "build" || id === "agent") {
		return COPILOT_MODE_AGENT_URI
	}
	if (id === "autopilot") {
		return COPILOT_MODE_AUTOPILOT_URI
	}
	if (id === "plan") {
		return COPILOT_MODE_PLAN_URI
	}
	return id
}

export const copilotPresence = (
	installed: boolean,
	authenticated: boolean
): ProviderPresence => ({
	providerId: COPILOT_PROVIDER_ID,
	installed,
	authenticated
})

const pathEntries = (pathVar: string): ReadonlyArray<string> =>
	Arr.filter(Str.split(pathVar, ":"), (part) => Str.isNonEmpty(part))

export const probeCopilotPresence = Effect.fn("probeCopilotPresence")(function*() {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const pathVar = yield* Config.option(Config.string("PATH"))
	const home = yield* Config.option(Config.string("HOME"))
	const binaryOverride = yield* Config.option(Config.string("ACEPE_COPILOT_BIN"))
	const overrideInstalled = yield* Option.match(binaryOverride, {
		onNone: () => Effect.succeed(false),
		onSome: (filePath) => fs.exists(filePath)
	})
	const directories = Option.match(pathVar, {
		onNone: () => Arr.empty<string>(),
		onSome: pathEntries
	})
	const pathInstalled = yield* Effect.reduce(directories, () => false, (found, directory) => {
		if (found) {
			return Effect.succeed(true)
		}
		return fs.exists(path.join(directory, "copilot"))
	})
	const credentialsPath = Option.match(home, {
		onNone: () => Option.none<string>(),
		onSome: (homeDir) => Option.some(path.join(homeDir, ".copilot", "config.json"))
	})
	const authenticated = yield* Option.match(credentialsPath, {
		onNone: () => Effect.succeed(false),
		onSome: (filePath) => fs.exists(filePath)
	})
	return copilotPresence(overrideInstalled || pathInstalled, authenticated)
})

export const isCopilotPlanCapabilityEnabled = (): boolean =>
	isCapabilityEnabled(COPILOT_CAPABILITIES, "plan")
