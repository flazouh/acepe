import * as Arr from "effect/Array"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import { relativeCmd } from "../../agentJson.ts"
import {
	isCapabilityEnabled,
	ProviderAdapterError,
	ProviderCapabilities,
	ProviderId,
	type ProviderPresence
} from "../../Services/ProviderAdapter.ts"

export const CODEX_PROVIDER_ID: ProviderId = ProviderId.make("codex")

export const adapterError = (
	operation: ProviderAdapterError["operation"],
	detail: string
): ProviderAdapterError =>
	new ProviderAdapterError({
		providerId: CODEX_PROVIDER_ID,
		operation,
		detail
	})

export const CODEX_DEFERRED_SESSION_CREATION = false

// Isolation audit (companion to CLAUDE_ISOLATED_SETTING_SOURCES in
// Claude/Provider.ts): the codex CLI, like claude, silently loads the
// operator's *user*-scoped ~/.codex config by default — ~/.codex/config.toml
// (mcp_servers, model/sandbox prefs) and ~/.codex/hooks.json (personal
// hooks), spawned as children of the app-server process. Verified
// empirically against the real codex CLI (v0.147.0):
//   - `codex exec` with no overrides inherits config.toml's mcp_servers and
//     prints "loading hooks from ... hooks.json and config.toml".
//   - `codex exec -c 'mcp_servers={}'` blocks the mcp_servers inheritance
//     (no personal MCP server child spawns) while keeping auth intact.
//   - `codex exec --disable hooks` (equivalent to `-c features.hooks=false`)
//     suppresses the hooks.json load — the warning disappears entirely.
//   - Project-level AGENTS.md in the session's cwd still loads and is
//     honored with both overrides applied — legitimate task context stays.
//   - `--ignore-user-config` (skips config.toml wholesale) exists on `codex
//     exec`/the interactive CLI but is NOT exposed on `codex app-server`
//     (checked its --help; only `-c`/`--enable`/`--disable` are available),
//     so it can't be used here. A fully separate CODEX_HOME was tried and
//     rejected: with no ~/.codex/auth.json present it hung indefinitely
//     waiting on stdin for an onboarding/login flow — worse than the
//     original bug, and the "do not hack fake homes" guidance applies.
// `-c mcp_servers={}` + `--disable hooks` is therefore the isolation
// Adapter.ts actually gets: it stops the MCP-server child-process
// inheritance (the reported bug's mechanism) and the hooks.json load, using
// only officially documented app-server flags. Acepe's own config.toml
// reads (loadCodexNativeConfigState in Config.ts) already extract model/
// reasoning-effort continuity on the Effect side rather than relying on the
// app-server loading the raw file, so this doesn't regress that.
export const CODEX_APP_SERVER_ARGS = [
	"app-server",
	"-c",
	"mcp_servers={}",
	"--disable",
	"hooks"
] as const

export const CODEX_PLACEHOLDER_COMMAND = "codex"

export const CODEX_REQUEST_TIMEOUT_SECONDS = 30

export const CODEX_CAPABILITIES: ProviderCapabilities = ProviderCapabilities.make({
	enabled: [
		"models",
		"modes",
		"configOptions",
		"plan",
		"usage",
		"toolCalls",
		"permissionRequests"
	]
})

export const CODEX_MODES = ["agent", "plan"] as const
export type CodexMode = (typeof CODEX_MODES)[number]

export const DEFAULT_CODEX_MODE: CodexMode = "agent"

export const CODEX_MODELS = [
	"gpt-5.4",
	"gpt-5.4-mini",
	"gpt-5.3-codex",
	"gpt-5.3-codex-spark",
	"gpt-5.2-codex",
	"gpt-5.2"
] as const
export type CodexModel = (typeof CODEX_MODELS)[number]

export const CODEX_REASONING_EFFORTS = ["xhigh", "high", "medium", "low", "minimal"] as const
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number]

export const DEFAULT_CODEX_MODEL_ID: CodexModel = "gpt-5.3-codex"
export const DEFAULT_CODEX_REASONING_EFFORT: CodexReasoningEffort = "high"

export const CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS =
	"# Plan Mode\n\nProduce a decision-complete implementation plan before execution."
export const CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS =
	"# Default Mode\n\nMake reasonable assumptions and execute the user's request."

export const CODEX_AUTH_RELATIVE_PATH = ".codex/auth.json"
export const CODEX_CONFIG_RELATIVE_PATH = ".codex/config.toml"

const THREAD_NOT_FOUND_SNIPPET = "thread not found"
const THREAD_RESUME_TIMEOUT_SNIPPET = "timed out waiting for server"

const CodexCacheMeta = Schema.Struct({
	cmd: Schema.String
})
const decodeCacheMeta = Schema.decodeUnknownEffect(Schema.fromJsonString(CodexCacheMeta))

export type CodexNativeConfigState = {
	readonly currentModelId: string
	readonly reasoningEffort: string
	readonly fastMode: boolean
}

export const defaultCodexNativeConfigState = (): CodexNativeConfigState => ({
	currentModelId: DEFAULT_CODEX_MODEL_ID,
	reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
	fastMode: false
})

export type CodexSpawnConfig = {
	readonly command: string
	readonly args: ReadonlyArray<string>
}

export const placeholderCodexSpawnConfig = (): CodexSpawnConfig => ({
	command: CODEX_PLACEHOLDER_COMMAND,
	args: Arr.fromIterable(CODEX_APP_SERVER_ARGS)
})

export const codexPresence = (installed: boolean, authenticated: boolean): ProviderPresence => ({
	providerId: CODEX_PROVIDER_ID,
	installed,
	authenticated
})

export const isCodexPlanCapabilityEnabled = (): boolean =>
	isCapabilityEnabled(CODEX_CAPABILITIES, "plan")

export const normalizeCodexModelId = (modelId: string): string => {
	const trimmed = Str.trim(modelId)
	if (Str.isNonEmpty(trimmed)) {
		return trimmed
	}
	return DEFAULT_CODEX_MODEL_ID
}

export const normalizeCodexReasoningEffort = (value: string): Option.Option<CodexReasoningEffort> => {
	const normalized = Str.toLowerCase(Str.trim(value))
	if (normalized === "xhigh") {
		return Option.some("xhigh")
	}
	if (normalized === "high") {
		return Option.some("high")
	}
	if (normalized === "medium") {
		return Option.some("medium")
	}
	if (normalized === "low") {
		return Option.some("low")
	}
	if (normalized === "minimal") {
		return Option.some("minimal")
	}
	return Option.none()
}

export const parseCodexServiceTier = (value: string): Option.Option<boolean> => {
	const normalized = Str.toLowerCase(Str.trim(value))
	if (normalized === "fast") {
		return Option.some(true)
	}
	if (normalized === "flex" || normalized === "default") {
		return Option.some(false)
	}
	return Option.none()
}

export const parseCodexFastModeValue = (value: string): Option.Option<boolean> => {
	const normalized = Str.toLowerCase(Str.trim(value))
	if (normalized === "true" || normalized === "on" || normalized === "enabled" || normalized === "1") {
		return Option.some(true)
	}
	if (
		normalized === "false" ||
		normalized === "off" ||
		normalized === "disabled" ||
		normalized === "0"
	) {
		return Option.some(false)
	}
	return Option.none()
}

export const resolveCodexModeId = (modeId: string): Option.Option<CodexMode> => {
	if (modeId === "plan") {
		return Option.some("plan")
	}
	if (modeId === "agent" || modeId === "build" || modeId === "default") {
		return Option.some("agent")
	}
	return Option.none()
}

export const cachedCodexBinaryPath = Effect.fn("cachedCodexBinaryPath")(function*(cacheDir: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const agentDir = path.join(cacheDir, "codex")
	const metaPath = path.join(agentDir, "meta.json")
	const metaExists = yield* fs.exists(metaPath)
	if (metaExists === false) {
		return Option.none<string>()
	}
	const text = yield* fs.readFileString(metaPath)
	const meta = yield* Effect.option(decodeCacheMeta(text))
	if (Option.isNone(meta)) {
		return Option.none<string>()
	}
	const binaryPath = path.join(agentDir, relativeCmd(meta.value.cmd))
	const binaryExists = yield* fs.exists(binaryPath)
	if (binaryExists === false) {
		return Option.none<string>()
	}
	return Option.some(binaryPath)
})

export const resolveCodexSpawnConfig = Effect.fn("resolveCodexSpawnConfig")(function*(
	cacheDir: Option.Option<string>
) {
	const cached = yield* Option.match(cacheDir, {
		onNone: () => Effect.succeed(Option.none<string>()),
		onSome: (dir) => cachedCodexBinaryPath(dir)
	})
	return Option.match(cached, {
		onNone: placeholderCodexSpawnConfig,
		onSome: (command) => ({
			command,
			args: Arr.fromIterable(CODEX_APP_SERVER_ARGS)
		})
	})
})

export const probeCodexPresence = Effect.fn("probeCodexPresence")(function*(
	cacheDir: Option.Option<string>
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const home = yield* Config.option(Config.string("HOME"))
	const spawn = yield* resolveCodexSpawnConfig(cacheDir)
	const installed = spawn.command !== CODEX_PLACEHOLDER_COMMAND
	const authPath = Option.map(home, (homeDir) => path.join(homeDir, CODEX_AUTH_RELATIVE_PATH))
	const authenticated = yield* Option.match(authPath, {
		onNone: () => Effect.succeed(false),
		onSome: (filePath) => fs.exists(filePath)
	})
	return codexPresence(installed, authenticated)
})

export const isRecoverableThreadResumeError = (detail: string): boolean => {
	const lowered = Str.toLowerCase(detail)
	if (Str.includes("session not found")(lowered)) {
		return true
	}
	if (Str.includes("thread/resume")(lowered) === false) {
		return false
	}
	return (
		Str.includes(THREAD_NOT_FOUND_SNIPPET)(lowered) ||
		Str.includes(THREAD_RESUME_TIMEOUT_SNIPPET)(lowered)
	)
}
