import * as Arr from "effect/Array"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Str from "effect/String"
import {
	isCapabilityEnabled,
	ProviderAdapterError,
	ProviderCapabilities,
	ProviderId,
	type ProviderPresence
} from "../../Services/ProviderAdapter.ts"

export const COPILOT_PROVIDER_ID: ProviderId = ProviderId.make("copilot")

export const adapterError = (
	operation: ProviderAdapterError["operation"],
	detail: string
): ProviderAdapterError =>
	new ProviderAdapterError({
		providerId: COPILOT_PROVIDER_ID,
		operation,
		detail
	})

export const COPILOT_TRANSPORT = "acp" as const

export const COPILOT_ACP_STDIO_ARGS = ["--acp", "--stdio"] as const

// The name the GitHub Copilot CLI installs on PATH, and the environment
// variable that overrides it with an absolute path. Same pair OpenCode and
// Codex resolve their own binary through.
export const COPILOT_BINARY_NAME = "copilot"
export const COPILOT_BINARY_ENV_KEY = "ACEPE_COPILOT_BIN"

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

export type CopilotPermissionDecision = "allow" | "deny"

export type CopilotLaunchConfig = {
	readonly command: string
	readonly args: ReadonlyArray<string>
}

const COPILOT_MODE_AGENT_URI = "https://agentclientprotocol.com/protocol/session-modes#agent"
const COPILOT_MODE_PLAN_URI = "https://agentclientprotocol.com/protocol/session-modes#plan"
const COPILOT_MODE_AUTOPILOT_URI = "https://agentclientprotocol.com/protocol/session-modes#autopilot"
const LEGACY_COPILOT_MODE_AGENT_URI = "https://github.com/github/copilot-cli/mode#agent"
const LEGACY_COPILOT_MODE_PLAN_URI = "https://github.com/github/copilot-cli/mode#plan"
const LEGACY_COPILOT_MODE_AUTOPILOT_URI = "https://github.com/github/copilot-cli/mode#autopilot"

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

// The absolute path of the `copilot` executable, from the env override first
// and then the first PATH entry that holds one. None means the CLI is not
// installed, which is also what probeCopilotPresence reports as installed:
// false — the two read the same thing, so presence never claims a binary
// resolveCopilotLaunch cannot find.
export const probeCopilotBinary = Effect.fn("probeCopilotBinary")(function*() {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const override = yield* Config.option(Config.nonEmptyString(COPILOT_BINARY_ENV_KEY))
	if (Option.isSome(override)) {
		const exists = yield* fs.exists(override.value)
		if (exists) {
			return Option.some(override.value)
		}
	}
	const pathVar = yield* Config.option(Config.string("PATH"))
	const directories = Option.match(pathVar, {
		onNone: () => Arr.empty<string>(),
		onSome: pathEntries
	})
	return yield* Effect.reduce(directories, () => Option.none<string>(), (found, directory) => {
		if (Option.isSome(found)) {
			return Effect.succeed(found)
		}
		const candidate = path.join(directory, COPILOT_BINARY_NAME)
		return fs
			.exists(candidate)
			.pipe(Effect.map((exists) => (exists ? Option.some(candidate) : Option.none<string>())))
	})
})

export const probeCopilotPresence = Effect.fn("probeCopilotPresence")(function*() {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const home = yield* Config.option(Config.string("HOME"))
	const binary = yield* probeCopilotBinary()
	const credentialsPath = Option.match(home, {
		onNone: () => Option.none<string>(),
		onSome: (homeDir) => Option.some(path.join(homeDir, ".copilot", "config.json"))
	})
	const authenticated = yield* Option.match(credentialsPath, {
		onNone: () => Effect.succeed(false),
		onSome: (filePath) => fs.exists(filePath)
	})
	return copilotPresence(Option.isSome(binary), authenticated)
})

export const copilotLaunchConfig = (command: string): CopilotLaunchConfig => ({
	command,
	args: Arr.fromIterable(COPILOT_ACP_STDIO_ARGS)
})

// Named rather than falling back to a bare "copilot" spawn: a spawn of a
// command that is not there reports an opaque ENOENT from inside the
// transport, and the operator reads a transport fault where the real answer
// is that the CLI is not installed.
export const missingCopilotBinaryError = (): ProviderAdapterError =>
	adapterError(
		"startSession",
		`GitHub Copilot CLI is not installed. Put '${COPILOT_BINARY_NAME}' on PATH or set ${COPILOT_BINARY_ENV_KEY}.`
	)

export const isCopilotPlanCapabilityEnabled = (): boolean =>
	isCapabilityEnabled(COPILOT_CAPABILITIES, "plan")
