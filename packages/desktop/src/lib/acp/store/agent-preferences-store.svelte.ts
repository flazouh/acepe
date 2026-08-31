import { AGENT_ENV_OVERRIDES_SETTING_KEY, type AgentEnvOverridesByAgent } from "@acepe/contracts";
import * as Effect from "effect/Effect";
import { getContext, setContext } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import type { AppError } from "$lib/acp/errors/app-error.js";
import type { CustomAgentConfig } from "$lib/acp/logic/agent-manager.js";
import type { Agent } from "$lib/acp/store/types.js";
import type { UserSettingKey } from "$lib/services/user-settings-types.js";
import { backendClient } from "$lib/utils/backend-client.js";

const AGENT_PREFERENCES_STORE_KEY = Symbol("agent-preferences-store");

const HAS_COMPLETED_ONBOARDING_KEY: UserSettingKey = "has_completed_onboarding";
const SELECTED_AGENT_IDS_KEY: UserSettingKey = "selected_agent_ids";
const SEEN_AGENT_IDS_KEY: UserSettingKey = "seen_agent_ids";
const CUSTOM_AGENT_CONFIGS_KEY: UserSettingKey = "custom_agent_configs";
const AGENT_ENV_OVERRIDES_KEY: UserSettingKey = AGENT_ENV_OVERRIDES_SETTING_KEY;
const DEFAULT_AGENT_ID_KEY: UserSettingKey = "default_agent_id";

/** The whole `agent_env_overrides` setting: one variable map per agent id. */
export type AgentEnvOverrides = AgentEnvOverridesByAgent;

export interface AgentPreferencesInitializationInput {
	readonly persistedOnboardingCompleted: boolean | null;
	readonly persistedSelectedAgentIds: readonly string[] | null;
	readonly persistedSeenAgentIds: readonly string[] | null;
	readonly projectCount: number | null;
	readonly availableAgentIds: readonly string[];
}

export interface AgentPreferencesInitializationState {
	readonly onboardingCompleted: boolean;
	readonly selectedAgentIds: string[];
	readonly seenAgentIds: string[];
	readonly shouldPersistOnboardingCompleted: boolean;
	readonly shouldPersistSelectedAgentIds: boolean;
	readonly shouldPersistSeenAgentIds: boolean;
}

/**
 * First-class agents that shipped before `seen_agent_ids`. A null seen list
 * treats these as already offered, so a new id such as grok-build auto-enables
 * without turning a disabled legacy agent back on.
 */
export const LEGACY_FIRST_CLASS_AGENT_IDS = [
	"claude-code",
	"copilot",
	"cursor",
	"opencode",
	"codex",
	"forge",
] as const;

interface AgentScopedItem {
	readonly agentId: string;
}

type SelectedAgentValidationResult =
	| { readonly ok: true; readonly value: string[] }
	| { readonly ok: false; readonly error: string };

/**
 * Returns selected agent IDs intersected with candidate IDs.
 * If `selectedAgentIds` is empty, returns all candidate IDs.
 */
export function intersectSelectedAgentIds(
	selectedAgentIds: readonly string[],
	candidateAgentIds: readonly string[]
): string[] {
	const selectedSet = new SvelteSet(selectedAgentIds);
	const seen = new SvelteSet<string>();

	if (selectedSet.size === 0) {
		const result: string[] = [];
		for (const candidateId of candidateAgentIds) {
			if (seen.has(candidateId)) continue;
			seen.add(candidateId);
			result.push(candidateId);
		}
		return result;
	}

	const result: string[] = [];
	for (const selectedId of selectedAgentIds) {
		if (seen.has(selectedId)) continue;
		if (!candidateAgentIds.includes(selectedId)) continue;
		seen.add(selectedId);
		result.push(selectedId);
	}
	return result;
}

/**
 * Filters items by selected agent IDs after preference initialization.
 * Before initialization, returns all items to avoid startup flicker.
 */
export function filterItemsBySelectedAgentIds<T extends AgentScopedItem>(
	items: readonly T[],
	selectedAgentIds: readonly string[],
	initialized: boolean
): T[] {
	if (!initialized) {
		return [...items];
	}

	const selectedSet = new SvelteSet(selectedAgentIds);
	if (selectedSet.size === 0) {
		return [...items];
	}

	return items.filter((item) => selectedSet.has(item.agentId));
}

export function validateAndNormalizeSelectedAgentIds(
	agentIds: readonly string[]
): SelectedAgentValidationResult {
	const normalized = Array.from(new SvelteSet(agentIds));
	if (normalized.length === 0) {
		return { ok: false, error: "At least one agent must remain selected" };
	}
	return { ok: true, value: normalized };
}

export function upsertCustomAgentConfigs(
	configs: readonly CustomAgentConfig[],
	config: CustomAgentConfig
): CustomAgentConfig[] {
	const existingIndex = configs.findIndex((entry) => entry.id === config.id);
	if (existingIndex < 0) {
		return [...configs, config];
	}

	return configs.map((entry, index) => (index === existingIndex ? config : entry));
}

function cloneAgentEnv(env: Readonly<Record<string, string>>): Record<string, string> {
	const copy: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		copy[key] = value;
	}
	return copy;
}

export function getAgentEnvOverridesForAgent(
	overrides: Readonly<AgentEnvOverrides>,
	agentId: string
): Record<string, string> {
	const saved = overrides[agentId];
	if (!saved) {
		return {};
	}

	return cloneAgentEnv(saved);
}

export function upsertAgentEnvOverrides(
	overrides: Readonly<AgentEnvOverrides>,
	agentId: string,
	env: Readonly<Record<string, string>>
): AgentEnvOverrides {
	// Built mutably here and handed back as the contract's readonly shape.
	const next: Record<string, Record<string, string>> = {};

	for (const [existingAgentId, existingEnv] of Object.entries(overrides)) {
		if (existingAgentId === agentId) {
			continue;
		}
		next[existingAgentId] = cloneAgentEnv(existingEnv);
	}

	if (Object.keys(env).length > 0) {
		next[agentId] = cloneAgentEnv(env);
	}

	return next;
}

function uniqueAgentIds(ids: readonly string[]): string[] {
	return Array.from(new SvelteSet(ids));
}

function seenListChanged(
	persistedSeenAgentIds: readonly string[] | null,
	seenAgentIds: readonly string[]
): boolean {
	if (persistedSeenAgentIds === null) {
		return true;
	}
	if (persistedSeenAgentIds.length !== seenAgentIds.length) {
		return true;
	}
	const persisted = new SvelteSet(persistedSeenAgentIds);
	return seenAgentIds.some((id) => !persisted.has(id));
}

/**
 * Computes onboarding + selected-agent initialization with migration defaults.
 */
export function deriveAgentPreferencesInitializationState(
	input: AgentPreferencesInitializationInput
): AgentPreferencesInitializationState {
	const availableAgentIds = uniqueAgentIds(input.availableAgentIds);

	const onboardingCompleted =
		input.persistedOnboardingCompleted !== null
			? input.persistedOnboardingCompleted
			: (input.projectCount ?? 0) > 0;

	const shouldPersistOnboardingCompleted =
		input.persistedOnboardingCompleted === null && onboardingCompleted;

	const persistedSelected = input.persistedSelectedAgentIds
		? intersectSelectedAgentIds(input.persistedSelectedAgentIds, availableAgentIds)
		: [];

	const seenSeed =
		input.persistedSeenAgentIds === null
			? [...LEGACY_FIRST_CLASS_AGENT_IDS]
			: uniqueAgentIds(input.persistedSeenAgentIds);
	const alreadySeen = new SvelteSet(seenSeed);
	const unseen = availableAgentIds.filter((id) => !alreadySeen.has(id));
	const seenAgentIds = uniqueAgentIds([...seenSeed, ...availableAgentIds]);
	const shouldPersistSeenAgentIds = seenListChanged(input.persistedSeenAgentIds, seenAgentIds);

	if (persistedSelected.length > 0) {
		const selectedAgentIds = uniqueAgentIds([...persistedSelected, ...unseen]);
		return {
			onboardingCompleted,
			selectedAgentIds,
			seenAgentIds,
			shouldPersistOnboardingCompleted,
			shouldPersistSelectedAgentIds: unseen.length > 0,
			shouldPersistSeenAgentIds,
		};
	}

	if (onboardingCompleted) {
		return {
			onboardingCompleted,
			selectedAgentIds: availableAgentIds,
			seenAgentIds,
			shouldPersistOnboardingCompleted,
			shouldPersistSelectedAgentIds: true,
			shouldPersistSeenAgentIds,
		};
	}

	return {
		onboardingCompleted,
		selectedAgentIds: availableAgentIds,
		seenAgentIds,
		shouldPersistOnboardingCompleted,
		shouldPersistSelectedAgentIds: false,
		shouldPersistSeenAgentIds,
	};
}

function chainPersistOperations(
	operations: ReadonlyArray<Effect.Effect<void, AppError>>
): Effect.Effect<void, AppError> {
	return operations.reduce<Effect.Effect<void, AppError>>(
		(acc, operation) => acc.pipe(Effect.flatMap(() => operation)),
		Effect.succeed(undefined)
	);
}

export class AgentPreferencesStore {
	selectedAgentIds = $state<string[]>([]);
	defaultAgentId = $state<string | null>(null);
	onboardingCompleted = $state<boolean>(false);
	customAgentConfigs = $state<CustomAgentConfig[]>([]);
	agentEnvOverrides = $state<AgentEnvOverrides>({});
	initialized = $state(false);

	private localMutationRevision = 0;

	private markLocalMutation(): void {
		this.localMutationRevision += 1;
	}

	primeStartupDefaults(agents: readonly Agent[], projectCount: number | null): void {
		if (this.initialized) {
			return;
		}

		const availableAgentIds = agents.map((agent) => agent.id);
		const initState = deriveAgentPreferencesInitializationState({
			persistedOnboardingCompleted: null,
			persistedSelectedAgentIds: null,
			persistedSeenAgentIds: null,
			projectCount,
			availableAgentIds,
		});

		this.onboardingCompleted = initState.onboardingCompleted;
		this.selectedAgentIds = initState.selectedAgentIds;
		if (this.defaultAgentId && !initState.selectedAgentIds.includes(this.defaultAgentId)) {
			this.defaultAgentId = null;
		}
	}

	initialize(agents: readonly Agent[], projectCount: number | null): Effect.Effect<void, Error> {
		const availableAgentIds = agents.map((agent) => agent.id);
		const initializationMutationRevision = this.localMutationRevision;

		return Effect.all([
			backendClient.settings.get<boolean>(HAS_COMPLETED_ONBOARDING_KEY),
			backendClient.settings.get<string[]>(SELECTED_AGENT_IDS_KEY),
			backendClient.settings.get<string[]>(SEEN_AGENT_IDS_KEY),
			backendClient.settings.get<CustomAgentConfig[]>(CUSTOM_AGENT_CONFIGS_KEY),
			backendClient.settings.get<AgentEnvOverrides>(AGENT_ENV_OVERRIDES_KEY),
			backendClient.settings.get<string>(DEFAULT_AGENT_ID_KEY),
		]).pipe(
			Effect.flatMap(
				([
					persistedOnboardingCompleted,
					persistedSelectedAgentIds,
					persistedSeenAgentIds,
					persistedCustom,
					persistedAgentEnvOverrides,
					persistedDefaultAgentId,
				]) => {
					if (initializationMutationRevision !== this.localMutationRevision) {
						this.initialized = true;
						return Effect.succeed(undefined);
					}

					const initState = deriveAgentPreferencesInitializationState({
						persistedOnboardingCompleted,
						persistedSelectedAgentIds,
						persistedSeenAgentIds,
						projectCount,
						availableAgentIds,
					});

					this.onboardingCompleted = initState.onboardingCompleted;
					this.selectedAgentIds = initState.selectedAgentIds;
					this.customAgentConfigs = persistedCustom ?? [];
					this.agentEnvOverrides = persistedAgentEnvOverrides ?? {};
					this.defaultAgentId =
						persistedDefaultAgentId && initState.selectedAgentIds.includes(persistedDefaultAgentId)
							? persistedDefaultAgentId
							: null;

					const persistOperations: Effect.Effect<void, AppError>[] = [];
					if (initState.shouldPersistOnboardingCompleted) {
						persistOperations.push(
							backendClient.settings.set(
								HAS_COMPLETED_ONBOARDING_KEY,
								initState.onboardingCompleted
							)
						);
					}
					if (initState.shouldPersistSelectedAgentIds) {
						persistOperations.push(
							backendClient.settings.set(SELECTED_AGENT_IDS_KEY, initState.selectedAgentIds)
						);
					}
					if (initState.shouldPersistSeenAgentIds) {
						persistOperations.push(
							backendClient.settings.set(SEEN_AGENT_IDS_KEY, initState.seenAgentIds)
						);
					}

					return chainPersistOperations(persistOperations).pipe(
						Effect.map(() => {
							this.initialized = true;
							return undefined;
						})
					);
				}
			),
			Effect.mapError(
				(error) => new Error(`Failed to initialize agent preferences: ${error.message}`)
			)
		);
	}

	setSelectedAgentIds(agentIds: readonly string[]): Effect.Effect<void, Error> {
		const validation = validateAndNormalizeSelectedAgentIds(agentIds);
		if (!validation.ok) {
			return Effect.fail(new Error(validation.error));
		}

		const normalized = validation.value;
		this.markLocalMutation();
		this.selectedAgentIds = normalized;

		// Clear default agent if it was removed from the selected list
		if (this.defaultAgentId && !normalized.includes(this.defaultAgentId)) {
			this.defaultAgentId = null;
			return backendClient.settings.set(SELECTED_AGENT_IDS_KEY, normalized).pipe(
				Effect.flatMap(() => backendClient.settings.set(DEFAULT_AGENT_ID_KEY, null)),
				Effect.mapError((error) => new Error(`Failed to persist selected agents: ${error.message}`))
			);
		}

		return backendClient.settings
			.set(SELECTED_AGENT_IDS_KEY, normalized)
			.pipe(
				Effect.mapError((error) => new Error(`Failed to persist selected agents: ${error.message}`))
			);
	}

	setDefaultAgentId(agentId: string | null): Effect.Effect<void, Error> {
		// Validate that the agent is in the selected list (or null to clear)
		if (agentId !== null && !this.selectedAgentIds.includes(agentId)) {
			return Effect.succeed(undefined);
		}

		this.markLocalMutation();
		this.defaultAgentId = agentId;
		return backendClient.settings
			.set(DEFAULT_AGENT_ID_KEY, agentId)
			.pipe(
				Effect.mapError((error) => new Error(`Failed to persist default agent: ${error.message}`))
			);
	}

	completeOnboarding(agentIds: readonly string[]): Effect.Effect<void, Error> {
		return this.setSelectedAgentIds(agentIds).pipe(
			Effect.flatMap(() => {
				this.markLocalMutation();
				this.onboardingCompleted = true;
				return backendClient.settings
					.set(HAS_COMPLETED_ONBOARDING_KEY, true)
					.pipe(
						Effect.mapError(
							(error) => new Error(`Failed to persist onboarding completion: ${error.message}`)
						)
					);
			})
		);
	}

	resetOnboardingForDev(): Effect.Effect<void, Error> {
		this.markLocalMutation();
		this.onboardingCompleted = false;
		return backendClient.settings
			.set(HAS_COMPLETED_ONBOARDING_KEY, false)
			.pipe(
				Effect.mapError(
					(error) => new Error(`Failed to reset onboarding completion: ${error.message}`)
				)
			);
	}

	addCustomAgentConfig(config: CustomAgentConfig): Effect.Effect<void, Error> {
		const updatedConfigs = upsertCustomAgentConfigs(this.customAgentConfigs, config);

		this.markLocalMutation();
		this.customAgentConfigs = updatedConfigs;
		return backendClient.settings
			.set(CUSTOM_AGENT_CONFIGS_KEY, updatedConfigs)
			.pipe(
				Effect.mapError(
					(error) => new Error(`Failed to persist custom agent config: ${error.message}`)
				)
			);
	}

	getAgentEnvOverrides(agentId: string): Record<string, string> {
		return getAgentEnvOverridesForAgent(this.agentEnvOverrides, agentId);
	}

	setAgentEnvOverrides(
		agentId: string,
		env: Readonly<Record<string, string>>
	): Effect.Effect<void, Error> {
		const updatedOverrides = upsertAgentEnvOverrides(this.agentEnvOverrides, agentId, env);

		this.markLocalMutation();
		this.agentEnvOverrides = updatedOverrides;
		return backendClient.settings
			.set(AGENT_ENV_OVERRIDES_KEY, updatedOverrides)
			.pipe(
				Effect.mapError(
					(error) => new Error(`Failed to persist agent env overrides: ${error.message}`)
				)
			);
	}

	getSelectedAgentIdsForCandidates(candidateAgentIds: readonly string[]): string[] {
		return intersectSelectedAgentIds(this.selectedAgentIds, candidateAgentIds);
	}

	filterItemsBySelectedAgents<T extends AgentScopedItem>(items: readonly T[]): T[] {
		return filterItemsBySelectedAgentIds(items, this.selectedAgentIds, this.initialized);
	}

	getPanelSelectableAgents(agents: readonly Agent[]): Agent[] {
		const selectedIds = this.getSelectedAgentIdsForCandidates(agents.map((agent) => agent.id));
		return agents.filter((agent) => selectedIds.includes(agent.id));
	}
}

export function createAgentPreferencesStore(): AgentPreferencesStore {
	const store = new AgentPreferencesStore();
	setContext(AGENT_PREFERENCES_STORE_KEY, store);
	return store;
}

export function getAgentPreferencesStore(): AgentPreferencesStore {
	return getContext<AgentPreferencesStore>(AGENT_PREFERENCES_STORE_KEY);
}

export {
	CUSTOM_AGENT_CONFIGS_KEY,
	DEFAULT_AGENT_ID_KEY,
	HAS_COMPLETED_ONBOARDING_KEY,
	SEEN_AGENT_IDS_KEY,
	SELECTED_AGENT_IDS_KEY,
};
