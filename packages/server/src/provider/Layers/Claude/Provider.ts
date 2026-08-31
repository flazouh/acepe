import type { McpServerConfig, SettingSource } from "@anthropic-ai/claude-agent-sdk"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type { ConfigOptionData } from "../../configOptions.ts"
import {
	isCapabilityEnabled,
	ProviderAdapterError,
	ProviderCapabilities,
	ProviderId,
	PROVIDER_CAPABILITY_NAMES,
	type ProviderPresence
} from "../../Services/ProviderAdapter.ts"
import {
	homeRelativeFileExists,
	homeRelativeJsonKeyPresent,
	resolveExecutableOnPath
} from "../ExecutableProbe.ts"

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
		description:
			"Controls Claude reasoning depth. A change applies when the session next connects.",
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

// The one place that turns a session's stored reasoning_effort selection into
// the SDK's `effort` option value. "auto" and anything unrecognized both mean
// "let the SDK decide" (no effort option passed), so a stale stored value can
// never break a query launch. The catalog values line up with the SDK's own
// EffortLevel union by construction -- see CLAUDE_REASONING_OPTIONS.
export const claudeReasoningEffortFromConfig = (
	configOptions: Readonly<Record<string, string>>
): Option.Option<Exclude<ClaudeReasoningEffort, "auto">> => {
	const stored = configOptions[CLAUDE_REASONING_CONFIG_ID]
	const match = Arr.findFirst(
		CLAUDE_REASONING_OPTIONS,
		(row) => row.value === stored && row.value !== CLAUDE_REASONING_AUTO_VALUE
	)
	return Option.map(match, (row) => row.value as Exclude<ClaudeReasoningEffort, "auto">)
}

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

export const claudePresence = (
	installed: boolean,
	authenticated: boolean
): ProviderPresence => ({
	providerId: CLAUDE_PROVIDER_ID,
	installed,
	authenticated
})

// The file name the Claude CLI installer puts on PATH, and the credential
// store `claude auth login` writes, relative to the operator's home.
export const CLAUDE_BINARY_NAME = "claude"
export const CLAUDE_CREDENTIALS_RELATIVE_PATH = ".claude/.credentials.json"

// The CLI's own state file, and the key `claude auth login` fills in it
// whatever store holds the secret. On macOS the secret usually lives in the
// system keychain and the credentials FILE never exists, so this marker is
// what keeps a keychain login from reading as signed out.
export const CLAUDE_STATE_RELATIVE_PATH = ".claude.json"
export const CLAUDE_STATE_ACCOUNT_KEY = "oauthAccount"

// The claude-agent-sdk ships its own native CLI binary as an optional
// platform dependency (@anthropic-ai/claude-agent-sdk-<platform>), resolved
// dynamically at runtime — invisible to a bundler's static analysis, so a
// packaged build (Electrobun's `bun build` step) drops it and query() fails
// with "Native CLI binary ... not found". Resolving the system `claude` on
// PATH and passing it as query()'s pathToClaudeCodeExecutable sidesteps that
// bundled binary entirely; see makeLiveClaudeAdapter in Adapter.ts.
export const resolveClaudeExecutablePath = Effect.fn("resolveClaudeExecutablePath")(function*() {
	return yield* resolveExecutableOnPath(CLAUDE_BINARY_NAME)
})

export const probeClaudePresence = Effect.fn("probeClaudePresence")(function*() {
	const binary = yield* resolveExecutableOnPath(CLAUDE_BINARY_NAME)
	// Either signal answers "signed in": the credential FILE (Linux, and
	// macOS setups that opted out of the keychain) or the state file's
	// account marker (keychain logins write no credential file at all).
	const credentialsFile = yield* homeRelativeFileExists(CLAUDE_CREDENTIALS_RELATIVE_PATH)
	const stateAccount = yield* homeRelativeJsonKeyPresent(
		CLAUDE_STATE_RELATIVE_PATH,
		CLAUDE_STATE_ACCOUNT_KEY
	)
	return claudePresence(Option.isSome(binary), credentialsFile || stateAccount)
})

export const isClaudePlanCapabilityEnabled = (): boolean =>
	isCapabilityEnabled(CLAUDE_CAPABILITIES, "plan")
