import * as Arr from "effect/Array"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Str from "effect/String"
import {
	type AgentJson,
	binaryTargetForPlatform,
	findAgentJson,
	type PlatformKey
} from "../../agentJson.ts"
import {
	ProviderAdapterError,
	ProviderCapabilities,
	ProviderId,
	type ProviderPresence
} from "../../Services/ProviderAdapter.ts"
import type { CursorLaunchConfig } from "./Process.ts"

export const CURSOR_PROVIDER_ID: ProviderId = ProviderId.make("cursor")

export const CURSOR_REGISTRY_AGENT_ID = "cursor"

export const CURSOR_CAPABILITIES: ProviderCapabilities = ProviderCapabilities.make({
	enabled: ["models", "modes", "commands", "plan", "toolCalls", "permissionRequests"]
})

export const CURSOR_MODES = ["agent", "ask"] as const
export type CursorMode = (typeof CURSOR_MODES)[number]

export type CursorPermissionDecision = "allow" | "deny"

export type CursorLaunchPlan = {
	readonly cmd: string
	readonly args: ReadonlyArray<string>
}

export const cursorPresence = (installed: boolean, authenticated: boolean): ProviderPresence => ({
	providerId: CURSOR_PROVIDER_ID,
	installed,
	authenticated
})

export const adapterError = (
	operation: ProviderAdapterError["operation"],
	detail: string
): ProviderAdapterError =>
	new ProviderAdapterError({
		providerId: CURSOR_PROVIDER_ID,
		operation,
		detail
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

// The name the Cursor CLI installer puts on PATH, and the environment
// variable that overrides it with an absolute path.
export const CURSOR_BINARY_NAME = "cursor-agent"
export const CURSOR_BINARY_ENV_KEY = "ACEPE_CURSOR_BIN"

// `acp` is a subcommand, not a flag. The ACP registry entry for Cursor runs
// the same one (see Provider.test.ts's agent.json fixture), so an
// Acepe-installed binary and an operator-installed one are launched
// identically.
export const CURSOR_ACP_ARGS = ["acp"] as const

export const cursorLaunchConfig = (command: string): CursorLaunchConfig => ({
	command,
	args: Arr.fromIterable(CURSOR_ACP_ARGS)
})

const pathEntries = (pathVar: string): ReadonlyArray<string> =>
	Arr.filter(Str.split(pathVar, ":"), (part) => Str.isNonEmpty(part))

// The absolute path of the `cursor-agent` executable, from the env override
// first and then the first PATH entry that holds one. This is the detection
// path Cursor was missing: its only launch resolver read AgentInstaller,
// which needs a PlatformKey nothing detects and a layer bootstrap never
// builds, so a Cursor the operator had installed was unreachable anyway.
// Same probe Claude, Codex, OpenCode and Copilot each use for their own CLI.
export const probeCursorBinary = Effect.fn("probeCursorBinary")(function*() {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const override = yield* Config.option(Config.nonEmptyString(CURSOR_BINARY_ENV_KEY))
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
		const candidate = path.join(directory, CURSOR_BINARY_NAME)
		return fs
			.exists(candidate)
			.pipe(Effect.map((exists) => (exists ? Option.some(candidate) : Option.none<string>())))
	})
})

// Named rather than falling back to a bare "cursor-agent" spawn: a spawn of
// a command that is not there reports an opaque ENOENT from inside the
// transport, and the operator reads a transport fault where the real answer
// is that the CLI is not installed.
export const missingCursorBinaryError = (): ProviderAdapterError =>
	adapterError(
		"startSession",
		`Cursor CLI is not installed. Put '${CURSOR_BINARY_NAME}' on PATH or set ${CURSOR_BINARY_ENV_KEY}.`
	)
