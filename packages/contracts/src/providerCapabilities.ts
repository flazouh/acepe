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

export type ProviderModeDescriptor = {
	readonly id: string
	readonly name: string
	readonly description: string
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
	{ id: "default", name: "Build", description: "Asks before it edits files or runs commands" },
	{ id: "plan", name: "Plan", description: "Researches and proposes a plan without changing anything" },
	{
		id: "acceptEdits",
		name: "Accept edits",
		description: "Applies file edits without asking, still asks before running commands"
	},
	{
		id: "bypassPermissions",
		name: "Bypass permissions",
		description: "Never asks. Every edit and command runs on its own"
	}
]

export const CLAUDE_PROVIDER_MODELS: ReadonlyArray<ProviderModelDescriptor> = [
	{ modelId: "claude-opus-4-6", name: "Opus 4.6" },
	{ modelId: "claude-sonnet-4-6", name: "Sonnet 4.6" },
	{ modelId: "claude-haiku-4-5", name: "Haiku 4.5" },
	{ modelId: "claude-opus-4-5", name: "Opus 4.5" },
	{ modelId: "claude-sonnet-4-5", name: "Sonnet 4.5" }
]

const CLAUDE_PROVIDER_IDS: ReadonlySet<string> = new Set(["claude", "claude-code", "claude_code"])

/** The modes a provider offers, or an empty list for one that offers none. */
export const providerModes = (
	providerId: string | null | undefined
): ReadonlyArray<ProviderModeDescriptor> =>
	providerId !== null && providerId !== undefined && CLAUDE_PROVIDER_IDS.has(providerId)
		? CLAUDE_PROVIDER_MODES
		: []

/** The models a provider offers, or an empty list for one that offers none. */
export const providerModels = (
	providerId: string | null | undefined
): ReadonlyArray<ProviderModelDescriptor> =>
	providerId !== null && providerId !== undefined && CLAUDE_PROVIDER_IDS.has(providerId)
		? CLAUDE_PROVIDER_MODELS
		: []
