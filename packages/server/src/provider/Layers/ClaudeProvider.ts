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
	PROVIDER_CAPABILITY_NAMES,
	type ProviderPresence
} from "../Services/ProviderAdapter.ts"

export const CLAUDE_PROVIDER_ID: ProviderId = ProviderId.make("claude-code")

export const CLAUDE_DEFERRED_SESSION_CREATION = true

export const CLAUDE_CAPABILITIES: ProviderCapabilities = ProviderCapabilities.make({
	enabled: Arr.fromIterable(PROVIDER_CAPABILITY_NAMES)
})

export const CLAUDE_MODES = ["default", "acceptEdits", "plan", "bypassPermissions"] as const
export type ClaudeMode = (typeof CLAUDE_MODES)[number]

export const CLAUDE_MODELS = [
	"claude-opus-4-6",
	"claude-sonnet-4-6",
	"claude-haiku-4-5",
	"claude-opus-4-5",
	"claude-sonnet-4-5"
] as const
export type ClaudeModel = (typeof CLAUDE_MODELS)[number]

export const resolveClaudeApiModelId = (model: string, contextWindow: "200k" | "1m"): string => {
	if (contextWindow === "1m" && Str.includes("[")(model) === false) {
		return `${model}[1m]`
	}
	return model
}

export const claudePresence = (
	installed: boolean,
	authenticated: boolean
): ProviderPresence => ({
	providerId: CLAUDE_PROVIDER_ID,
	installed,
	authenticated
})

const pathEntries = (pathVar: string): ReadonlyArray<string> =>
	Arr.filter(Str.split(pathVar, ":"), (part) => Str.isNonEmpty(part))

export const probeClaudePresence = Effect.fn("probeClaudePresence")(function*() {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const pathVar = yield* Config.option(Config.string("PATH"))
	const home = yield* Config.option(Config.string("HOME"))
	const directories = Option.match(pathVar, {
		onNone: () => Arr.empty<string>(),
		onSome: pathEntries
	})
	const installed = yield* Effect.reduce(directories, () => false, (found, directory) => {
		if (found) {
			return Effect.succeed(true)
		}
		return fs.exists(path.join(directory, "claude"))
	})
	const credentialsPath = Option.match(home, {
		onNone: () => Option.none<string>(),
		onSome: (homeDir) => Option.some(path.join(homeDir, ".claude", ".credentials.json"))
	})
	const authenticated = yield* Option.match(credentialsPath, {
		onNone: () => Effect.succeed(false),
		onSome: (filePath) => fs.exists(filePath)
	})
	return claudePresence(installed, authenticated)
})

export const isClaudePlanCapabilityEnabled = (): boolean =>
	isCapabilityEnabled(CLAUDE_CAPABILITIES, "plan")
