/**
 * What a provider can be asked to do, as contract-level facts.
 *
 * A session's available modes and models are not session state -- they do not
 * change as a turn runs, and no event carries them. They are properties of the
 * provider, and until now they lived as constants inside the server where the
 * client could never see them: the mode selector renders only when a session
 * reports modes, so it never rendered at all, and the model picker degraded to
 * a static agent label.
 *
 * Keeping them here rather than in either process means the adapter that
 * enforces a mode and the picker that offers it read the same list, so the two
 * cannot drift.
 */

/**
 * How a mode is drawn. Matches the client's ModeIconKind, which already carries
 * a colour per kind -- naming the kind here is what finally lights it up.
 */
export type ProviderModeIconKind =
	| "agent"
	| "plan"
	| "autonomous"
	| "bypass"
	| "ask"
	| "edit"
	| "review"
	| "unknown"

export type ProviderModeDescriptor = {
	readonly id: string
	readonly name: string
	readonly description: string
	readonly iconKind: ProviderModeIconKind
}

export type ProviderModelDescriptor = {
	readonly modelId: string
	readonly name: string
}

/**
 * Claude's mode IS the SDK's permission mode (query().setPermissionMode).
 * The ids are the SDK's own, so an adapter can pass one straight through.
 */
export const CLAUDE_PROVIDER_MODES: ReadonlyArray<ProviderModeDescriptor> = [
	{
		id: "default",
		name: "Build",
		description: "Asks before it edits files or runs commands",
		iconKind: "agent"
	},
	{
		id: "plan",
		name: "Plan",
		description: "Researches and proposes a plan without changing anything",
		iconKind: "plan"
	},
	{
		id: "acceptEdits",
		name: "Accept edits",
		description: "Applies file edits without asking, still asks before running commands",
		iconKind: "edit"
	},
	{
		id: "bypassPermissions",
		name: "Bypass permissions",
		description: "Never asks. Every edit and command runs on its own",
		iconKind: "bypass"
	}
]

export const CLAUDE_PROVIDER_MODELS: ReadonlyArray<ProviderModelDescriptor> = [
	{ modelId: "claude-opus-4-6", name: "Opus 4.6" },
	{ modelId: "claude-sonnet-4-6", name: "Sonnet 4.6" },
	{ modelId: "claude-haiku-4-5", name: "Haiku 4.5" },
	{ modelId: "claude-opus-4-5", name: "Opus 4.5" },
	{ modelId: "claude-sonnet-4-5", name: "Sonnet 4.5" }
]

export type ProviderConfigOptionValue = {
	readonly name: string
	readonly value: string
}

export type ProviderConfigOptionDescriptor = {
	readonly id: string
	readonly name: string
	readonly category: string
	readonly type: string
	readonly description: string
	readonly currentValue: string
	readonly options: ReadonlyArray<ProviderConfigOptionValue>
	readonly presentation: string
}

/**
 * Reasoning depth, the one setting Claude exposes per turn.
 *
 * The server already builds this option; it reached the client only through
 * `listPreconnectionCapabilities`, which answers `unsupportedOnContract`, so the
 * composer never had a reasoning control to render beside the model picker.
 */
export const CLAUDE_PROVIDER_CONFIG_OPTIONS: ReadonlyArray<ProviderConfigOptionDescriptor> = [
	{
		id: "reasoning_effort",
		name: "Reasoning Effort",
		category: "reasoning_effort",
		type: "select",
		description: "Controls Claude reasoning depth.",
		currentValue: "auto",
		options: [
			{ name: "Auto", value: "auto" },
			{ name: "Low", value: "low" },
			{ name: "Medium", value: "medium" },
			{ name: "High", value: "high" },
			{ name: "Extra High", value: "xhigh" },
			{ name: "Max", value: "max" }
		],
		presentation: "compactReasoning"
	}
]

export const CODEX_PROVIDER_MODES: ReadonlyArray<ProviderModeDescriptor> = [
	{
		id: "agent",
		name: "Agent",
		description: "Edits and runs commands, asking when it needs to",
		iconKind: "agent"
	},
	{
		id: "plan",
		name: "Plan",
		description: "Researches and proposes a plan without changing anything",
		iconKind: "plan"
	}
]

export const OPENCODE_PROVIDER_MODES: ReadonlyArray<ProviderModeDescriptor> = [
	{ id: "build", name: "Build", description: "Makes the change", iconKind: "agent" },
	{
		id: "plan",
		name: "Plan",
		description: "Proposes a plan without changing anything",
		iconKind: "plan"
	}
]

export const COPILOT_PROVIDER_MODES: ReadonlyArray<ProviderModeDescriptor> = [
	{
		id: "agent",
		name: "Agent",
		description: "Edits and runs commands, asking when it needs to",
		iconKind: "agent"
	},
	{ id: "autopilot", name: "Autopilot", description: "Keeps going without asking", iconKind: "autonomous" },
	{
		id: "plan",
		name: "Plan",
		description: "Proposes a plan without changing anything",
		iconKind: "plan"
	}
]

export const CURSOR_PROVIDER_MODES: ReadonlyArray<ProviderModeDescriptor> = [
	{ id: "agent", name: "Agent", description: "Edits and runs commands", iconKind: "agent" },
	{ id: "ask", name: "Ask", description: "Answers without changing anything", iconKind: "ask" }
]

const CLAUDE_PROVIDER_IDS: ReadonlySet<string> = new Set(["claude", "claude-code", "claude_code"])

/**
 * Each provider's own modes, under every id that provider answers to.
 *
 * The names are the provider's, not ours: a person switching between agents
 * should see the mode the agent itself calls it.
 */
const MODES_BY_PROVIDER_ID: ReadonlyMap<string, ReadonlyArray<ProviderModeDescriptor>> = new Map([
	["codex", CODEX_PROVIDER_MODES],
	["codex-cli", CODEX_PROVIDER_MODES],
	["opencode", OPENCODE_PROVIDER_MODES],
	["copilot", COPILOT_PROVIDER_MODES],
	["github-copilot", COPILOT_PROVIDER_MODES],
	["cursor", CURSOR_PROVIDER_MODES],
	["cursor-agent", CURSOR_PROVIDER_MODES]
])

/** The modes a provider offers, or an empty list for one that offers none. */
export const providerModes = (
	providerId: string | null | undefined
): ReadonlyArray<ProviderModeDescriptor> => {
	if (providerId === null || providerId === undefined) {
		return []
	}
	if (CLAUDE_PROVIDER_IDS.has(providerId)) {
		return CLAUDE_PROVIDER_MODES
	}
	return MODES_BY_PROVIDER_ID.get(providerId) ?? []
}

/** The per-turn settings a provider exposes, or an empty list for one with none. */
export const providerConfigOptions = (
	providerId: string | null | undefined
): ReadonlyArray<ProviderConfigOptionDescriptor> =>
	providerId !== null && providerId !== undefined && CLAUDE_PROVIDER_IDS.has(providerId)
		? CLAUDE_PROVIDER_CONFIG_OPTIONS
		: []

/** The models a provider offers, or an empty list for one that offers none. */
export const providerModels = (
	providerId: string | null | undefined
): ReadonlyArray<ProviderModelDescriptor> =>
	providerId !== null && providerId !== undefined && CLAUDE_PROVIDER_IDS.has(providerId)
		? CLAUDE_PROVIDER_MODELS
		: []
