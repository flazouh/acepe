import type { McpServerConfig, SettingSource } from "@anthropic-ai/claude-agent-sdk"
import * as Arr from "effect/Array"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Str from "effect/String"
import type { ConfigOptionData } from "../../configOptions.ts"
import {
	isCapabilityEnabled,
	ProviderAdapterError,
	ProviderCapabilities,
	ProviderId,
	PROVIDER_CAPABILITY_NAMES,
	type ProviderPresence
} from "../../Services/ProviderAdapter.ts"

export const CLAUDE_PROVIDER_ID: ProviderId = ProviderId.make("claude-code")

export const adapterError = (
	operation: ProviderAdapterError["operation"],
	detail: string
): ProviderAdapterError =>
	new ProviderAdapterError({
		providerId: CLAUDE_PROVIDER_ID,
		operation,
		detail
	})

export const CLAUDE_DEFERRED_SESSION_CREATION = true

export const CLAUDE_REASONING_CONFIG_ID = "reasoning_effort"
export const CLAUDE_REASONING_AUTO_VALUE = "auto"
export const CLAUDE_REASONING_PRESENTATION = "compactReasoning"

export const CLAUDE_REASONING_OPTIONS = [
	{ value: "auto", name: "Auto" },
	{ value: "low", name: "Low" },
	{ value: "medium", name: "Medium" },
	{ value: "high", name: "High" },
	{ value: "xhigh", name: "Extra High" },
	{ value: "max", name: "Max" }
] as const

export type ClaudeReasoningEffort = (typeof CLAUDE_REASONING_OPTIONS)[number]["value"]

export type ClaudeReasoningConfigState = {
	readonly effort: Option.Option<ClaudeReasoningEffort>
}

export const defaultClaudeReasoningConfigState = (): ClaudeReasoningConfigState => ({
	effort: Option.none()
})

export const buildClaudeReasoningConfigOptions = (
	state: ClaudeReasoningConfigState
): ReadonlyArray<ConfigOptionData> => {
	const currentValue = Option.getOrElse(state.effort, () => CLAUDE_REASONING_AUTO_VALUE)
	return Arr.of({
		id: CLAUDE_REASONING_CONFIG_ID,
		name: "Reasoning Effort",
		category: CLAUDE_REASONING_CONFIG_ID,
		type: "select",
		description: "Controls Claude reasoning depth.",
		currentValue,
		options: Arr.map(CLAUDE_REASONING_OPTIONS, (row) => ({
			name: row.name,
			value: row.value
		})),
		presentation: CLAUDE_REASONING_PRESENTATION
	})
}

export const claudePreconnectionConfigOptions = (): ReadonlyArray<ConfigOptionData> =>
	buildClaudeReasoningConfigOptions(defaultClaudeReasoningConfigState())

export const CLAUDE_CAPABILITIES: ProviderCapabilities = ProviderCapabilities.make({
	enabled: Arr.fromIterable(PROVIDER_CAPABILITY_NAMES)
})

// Acepe spawns `claude` as an embedded child of its own app, not as a stand-in
// for the operator running the CLI themselves. Loading the operator's
// *user*-scoped config — ~/.claude/settings.json (hooks) and ~/.claude.json
// (personal MCP servers such as a railway server or a personal-memory venv
// server) — silently runs the operator's entire personal automation stack
// inside every Acepe agent turn. Empirically verified live: with the SDK's
// query() defaults (no settingSources/strictMcpConfig override), the first
// turn of a session spawns the operator's personal MCP server child
// processes and blocks on them, while `claude -p "..."` on its own replies in
// seconds. Excluding the 'user' setting source (but keeping 'project' and
// 'local') stops that inheritance while still loading the *target repo's*
// own CLAUDE.md / .claude/settings.json — legitimate task context, not the
// operator's personal automation. See Process.ts's makeLiveCreateQuery.
export const CLAUDE_ISOLATED_SETTING_SOURCES: ReadonlyArray<SettingSource> = ["project", "local"]

// Belt-and-suspenders alongside CLAUDE_ISOLATED_SETTING_SOURCES: per the SDK
// docs, strictMcpConfig ignores MCP servers from project .mcp.json, user
// settings, plugins, and on-disk agent frontmatter, using only what's passed
// via `mcpServers` below. Verified empirically to independently block the
// operator's personal MCP servers too.
export const CLAUDE_STRICT_MCP_CONFIG = true

// MCP servers Acepe itself wires into a Claude session (as opposed to the
// operator's personal ~/.claude.json servers, which are deliberately
// excluded above). Acepe has its own MCP catalog (packages/server/src/mcp)
// but nothing resolves it into a session's query() options yet, so this
// stays empty — the seam is typed and threaded through so a future session-
// or agent-config-driven catalog resolution has somewhere to plug in.
export const CLAUDE_SESSION_MCP_SERVERS: Record<string, McpServerConfig> = {}

// Derived from the contract's own list, so the modes this adapter enforces and
// the modes the picker offers cannot drift apart.
export const CLAUDE_MODES = [
	"auto",
	"default",
	"acceptEdits",
	"plan",
	"bypassPermissions"
] as const
export type ClaudeMode = (typeof CLAUDE_MODES)[number]

export const DEFAULT_CLAUDE_MODE: ClaudeMode = "default"

// Claude's mode IS the SDK's permission mode (query().setPermissionMode, see
// Process.ts). Resolved at the adapter boundary so an unknown mode fails
// loudly instead of reaching the SDK as an invalid control request.
export const resolveClaudeModeId = (modeId: string): Option.Option<ClaudeMode> => {
	if (modeId === "plan") {
		return Option.some("plan")
	}
	// The SDK's own mode, and what Claude Code itself shows as "Auto": Claude
	// decides each permission rather than asking. Rejecting it here is what made
	// picking Auto in the composer do nothing at all.
	if (modeId === "auto") {
		return Option.some("auto")
	}
	if (modeId === "acceptEdits") {
		return Option.some("acceptEdits")
	}
	if (modeId === "bypassPermissions") {
		return Option.some("bypassPermissions")
	}
	if (modeId === "default" || modeId === "agent" || modeId === "build" || modeId === "manual") {
		return Option.some("default")
	}
	return Option.none()
}

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

// The claude-agent-sdk ships its own native CLI binary as an optional
// platform dependency (@anthropic-ai/claude-agent-sdk-<platform>), resolved
// dynamically at runtime — invisible to a bundler's static analysis, so a
// packaged build (Electrobun's `bun build` step) drops it and query() fails
// with "Native CLI binary ... not found". Resolving the system `claude` on
// PATH and passing it as query()'s pathToClaudeCodeExecutable sidesteps that
// bundled binary entirely; see makeLiveClaudeAdapter in Adapter.ts.
export const resolveClaudeExecutablePath = Effect.fn("resolveClaudeExecutablePath")(function*() {
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
		const candidate = path.join(directory, "claude")
		return fs.exists(candidate).pipe(
			Effect.map((exists) => (exists ? Option.some(candidate) : Option.none<string>()))
		)
	})
})

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
