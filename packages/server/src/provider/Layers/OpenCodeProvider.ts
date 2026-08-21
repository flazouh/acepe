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

export const OPENCODE_PROVIDER_ID: ProviderId = ProviderId.make("opencode")

export const OPENCODE_DEFERRED_SESSION_CREATION = false

export const OPENCODE_COMMUNICATION_MODE = "http" as const

export const OPENCODE_CAPABILITIES: ProviderCapabilities = ProviderCapabilities.make({
	enabled: [
		"models",
		"modes",
		"commands",
		"plan",
		"compaction",
		"usage",
		"toolCalls",
		"permissionRequests"
	]
})

export const OPENCODE_MODES = ["build", "plan"] as const
export type OpenCodeMode = (typeof OPENCODE_MODES)[number]

export const OPENCODE_DEFAULT_MODE: OpenCodeMode = "build"

export const OPENCODE_ALLOWED_ENV_KEYS = [
	"PATH",
	"HOME",
	"TERM",
	"TMPDIR",
	"SHELL",
	"USER",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"SSH_AUTH_SOCK",
	"OPENCODE_API_KEY"
] as const

export const OPENCODE_PLACEHOLDER_BINARY = "__acepe_missing_opencode_binary__"

const SERVE_URL_PATTERN = /https?:\/\/[^:\s]+:(?<port>\d+)(?<path>\/[^\s"']*)?/

export type OpenCodeServeUrl = {
	readonly port: number
	readonly apiPrefix: string
}

export const openCodePresence = (
	installed: boolean,
	authenticated: boolean
): ProviderPresence => ({
	providerId: OPENCODE_PROVIDER_ID,
	installed,
	authenticated
})

const pathEntries = (pathVar: string): ReadonlyArray<string> =>
	Arr.filter(Str.split(pathVar, ":"), (part) => Str.isNonEmpty(part))

export const normalizeOpenCodeServeArgs = (
	cachedArgs: ReadonlyArray<string>
): ReadonlyArray<string> => {
	const args = Arr.filter(cachedArgs, (arg) => Str.isNonEmpty(arg))
	const head = Arr.head(args)
	if (Option.isNone(head) || head.value === "acp") {
		return ["serve"]
	}
	return args
}

export const openCodeServeArgs = (cachedArgs: ReadonlyArray<string>): ReadonlyArray<string> =>
	Arr.appendAll(normalizeOpenCodeServeArgs(cachedArgs), ["--port", "0"])

export const parseServeUrl = (line: string): Option.Option<OpenCodeServeUrl> => {
	const match = SERVE_URL_PATTERN.exec(line)
	if (match === null || match.groups === undefined) {
		return Option.none()
	}
	const portText = match.groups.port
	const pathText = match.groups.path
	if (portText === undefined) {
		return Option.none()
	}
	const port = Number.parseInt(portText, 10)
	if (Number.isNaN(port) || port < 1 || port > 65535) {
		return Option.none()
	}
	if (pathText === undefined || pathText === "/") {
		return Option.some({
			port,
			apiPrefix: ""
		})
	}
	return Option.some({
		port,
		apiPrefix: pathText
	})
}

export const openCodeBaseUrl = (url: OpenCodeServeUrl): string =>
	`http://127.0.0.1:${String(url.port)}${url.apiPrefix}`

export const probeOpenCodeBinary = Effect.fn("probeOpenCodeBinary")(function*() {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const pathVar = yield* Config.option(Config.string("PATH"))
	const directories = Option.match(pathVar, {
		onNone: () => Arr.empty<string>(),
		onSome: pathEntries
	})
	return yield* Effect.reduce(directories, () => Option.none<string>(), (found, directory) => {
		if (Option.isSome(found)) {
			return Effect.succeed(found)
		}
		const candidate = path.join(directory, "opencode")
		return fs.exists(candidate).pipe(
			Effect.map((exists) => (exists ? Option.some(candidate) : Option.none()))
		)
	})
})

export const probeOpenCodePresence = Effect.fn("probeOpenCodePresence")(function*() {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const binary = yield* probeOpenCodeBinary()
	const installed = Option.isSome(binary)
	const apiKey = yield* Config.option(Config.string("OPENCODE_API_KEY"))
	if (Option.isSome(apiKey) && Str.isNonEmpty(Str.trim(apiKey.value))) {
		return openCodePresence(installed, true)
	}
	const home = yield* Config.option(Config.string("HOME"))
	const authPath = Option.match(home, {
		onNone: () => Option.none<string>(),
		onSome: (homeDir) =>
			Option.some(path.join(homeDir, ".local", "share", "opencode", "auth.json"))
	})
	const authenticated = yield* Option.match(authPath, {
		onNone: () => Effect.succeed(false),
		onSome: (filePath) => fs.exists(filePath)
	})
	return openCodePresence(installed, authenticated)
})

export const isOpenCodePlanCapabilityEnabled = (): boolean =>
	isCapabilityEnabled(OPENCODE_CAPABILITIES, "plan")
