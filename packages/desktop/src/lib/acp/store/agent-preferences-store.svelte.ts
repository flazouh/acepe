import { okAsync, ResultAsync } from "neverthrow";
import { getContext, setContext } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import type { AppError } from "$lib/acp/errors/app-error.js";
import type { CustomAgentConfig } from "$lib/acp/logic/agent-manager.js";
import type { Agent } from "$lib/acp/store/types.js";
import type { UserSettingKey } from "$lib/services/converted-session-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";

const AGENT_PREFERENCES_STORE_KEY = Symbol("agent-preferences-store");

const HAS_COMPLETED_ONBOARDING_KEY: UserSettingKey = "has_completed_onboarding";
const SELECTED_AGENT_IDS_KEY: UserSettingKey = "selected_agent_ids";
const CUSTOM_AGENT_CONFIGS_KEY: UserSettingKey = "custom_agent_configs";
const AGENT_ENV_OVERRIDES_KEY = "agent_env_overrides";
const DEFAULT_AGENT_ID_KEY: UserSettingKey = "default_agent_id";

export type AgentEnvOverrides = Record<string, Record<string, string>>;

export interface AgentPreferencesInitializationInput {
	readonly persistedOnboardingCompleted: boolean | null;
	readonly persistedSelectedAgentIds: readonly string[] | null;
	readonly projectCount: number | null;
	readonly availableAgentIds: readonly string[];
}

export interface AgentPreferencesInitializationState {
	readonly onboardingCompleted: boolean;
	readonly selectedAgentIds: string[];
	readonly shouldPersistOnboardingCompleted: boolean;
	readonly shouldPersistSelectedAgentIds: boolean;
}

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
	const next: AgentEnvOverrides = {};

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

/**
 * Computes onboarding + selected-agent initialization with migration defaults.
 */
export function deriveAgentPreferencesInitializationState(
	input: AgentPreferencesInitializationInput
): AgentPreferencesInitializationState {
	const availableAgentIds = Array.from(new SvelteSet(input.availableAgentIds));

	const onboardingCompleted =
		input.persistedOnboardingCompleted !== null
			? input.persistedOnboardingCompleted
			: (input.projectCount ?? 0) > 0;

	const shouldPersistOnboardingCompleted =
		input.persistedOnboardingCompleted === null && onboardingCompleted;

	const persistedSelected = input.persistedSelectedAgentIds
		? intersectSelectedAgentIds(input.persistedSelectedAgentIds, availableAgentIds)
		: [];

	if (persistedSelected.length > 0) {
		return {
			onboardingCompleted,
			selectedAgentIds: persistedSelected,
			shouldPersistOnboardingCompleted,
			shouldPersistSelectedAgentIds: false,
		};
	}

	if (onboardingCompleted) {
		return {
			onboardingCompleted,
			selectedAgentIds: availableAgentIds,
			shouldPersistOnboardingCompleted,
			shouldPersistSelectedAgentIds: true,
		};
	}

	return {
		onboardingCompleted,
		selectedAgentIds: availableAgentIds,
		shouldPersistOnboardingCompleted,
		shouldPersistSelectedAgentIds: false,
	};
}

function chainPersistOperations(operations: ReadonlyArray<ResultAsync<void, AppError>>) {
	return operations.reduce((acc, operation) => acc.andThen(() => operation), okAsync(undefined));
}

export class AgentPreferencesStore {
	selectedAgentIds = $state<string[]>([]);
	defaultAgentId = $state<string | null>(null);
	onboardingCompleted = $state<boolean>(false);
	customAgentConfigs = $state<CustomAgentConfig[]>([]);
	agentEnvOverrides = $state<AgentEnvOverrides>({});
	initialized = $state(false);

	initialize(agents: readonly Agent[], projectCount: number | null): ResultAsync<void, Error> {
		const availableAgentIds = agents.map((agent) => agent.id);

		return ResultAsync.combine([
			tauriClient.settings.get<boolean>(HAS_COMPLETED_ONBOARDING_KEY),
			tauriClient.settings.get<string[]>(SELECTED_AGENT_IDS_KEY),
			tauriClient.settings.get<CustomAgentConfig[]>(CUSTOM_AGENT_CONFIGS_KEY),
			tauriClient.settings.get<AgentEnvOverrides>(AGENT_ENV_OVERRIDES_KEY),
			tauriClient.settings.get<string>(DEFAULT_AGENT_ID_KEY),
		])
			.andThen(
				([
					persistedOnboardingCompleted,
					persistedSelectedAgentIds,
					persistedCustom,
					persistedAgentEnvOverrides,
					persistedDefaultAgentId,
				]) => {
					const initState = deriveAgentPreferencesInitializationState({
						persistedOnboardingCompleted,
						persistedSelectedAgentIds,
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

					const persistOperations: ResultAsync<void, AppError>[] = [];
					if (initState.shouldPersistOnboardingCompleted) {
						persistOperations.push(
							tauriClient.settings.set(HAS_COMPLETED_ONBOARDING_KEY, initState.onboardingCompleted)
						);
					}
					if (initState.shouldPersistSelectedAgentIds) {
						persistOperations.push(
							tauriClient.settings.set(SELECTED_AGENT_IDS_KEY, initState.selectedAgentIds)
						);
					}

					return chainPersistOperations(persistOperations).map(() => {
						this.initialized = true;
						return undefined;
					});
				}
			)
			.mapErr((error) => new Error(`Failed to initialize agent preferences: ${error.message}`));
	}

	setSelectedAgentIds(agentIds: readonly string[]): ResultAsync<void, Error> {
		const validation = validateAndNormalizeSelectedAgentIds(agentIds);
		if (!validation.ok) {
			return ResultAsync.fromPromise(Promise.reject(new Error(validation.error)), (error) =>
				error instanceof Error ? error : new Error(String(error))
			);
		}

		const normalized = validation.value;
		this.selectedAgentIds = normalized;

		// Clear default agent if it was removed from the selected list
		if (this.defaultAgentId && !normalized.includes(this.defaultAgentId)) {
			this.defaultAgentId = null;
			return tauriClient.settings
				.set(SELECTED_AGENT_IDS_KEY, normalized)
				.andThen(() => tauriClient.settings.set(DEFAULT_AGENT_ID_KEY, null))
				.mapErr((error) => new Error(`Failed to persist selected agents: ${error.message}`));
		}

		return tauriClient.settings
			.set(SELECTED_AGENT_IDS_KEY, normalized)
			.mapErr((error) => new Error(`Failed to persist selected agents: ${error.message}`));
	}

	setDefaultAgentId(agentId: string | null): ResultAsync<void, Error> {
		// Validate that the agent is in the selected list (or null to clear)
		if (agentId !== null && !this.selectedAgentIds.includes(agentId)) {
			return okAsync(undefined);
		}

		this.defaultAgentId = agentId;
		return tauriClient.settings
			.set(DEFAULT_AGENT_ID_KEY, agentId)
			.mapErr((error) => new Error(`Failed to persist default agent: ${error.message}`));
	}

	completeOnboarding(agentIds: readonly string[]): ResultAsync<void, Error> {
		return this.setSelectedAgentIds(agentIds).andThen(() => {
			this.onboardingCompleted = true;
			return tauriClient.settings
				.set(HAS_COMPLETED_ONBOARDING_KEY, true)
				.mapErr((error) => new Error(`Failed to persist onboarding completion: ${error.message}`));
		});
	}

	addCustomAgentConfig(config: CustomAgentConfig): ResultAsync<void, Error> {
		const updatedConfigs = upsertCustomAgentConfigs(this.customAgentConfigs, config);

		this.customAgentConfigs = updatedConfigs;
		return tauriClient.settings
			.set(CUSTOM_AGENT_CONFIGS_KEY, updatedConfigs)
			.mapErr((error) => new Error(`Failed to persist custom agent config: ${error.message}`));
	}

	getAgentEnvOverrides(agentId: string): Record<string, string> {
		return getAgentEnvOverridesForAgent(this.agentEnvOverrides, agentId);
	}

	setAgentEnvOverrides(
		agentId: string,
		env: Readonly<Record<string, string>>
	): ResultAsync<void, Error> {
		const updatedOverrides = upsertAgentEnvOverrides(this.agentEnvOverrides, agentId, env);

		this.agentEnvOverrides = updatedOverrides;
		return tauriClient.settings
			.set(AGENT_ENV_OVERRIDES_KEY, updatedOverrides)
			.mapErr((error) => new Error(`Failed to persist agent env overrides: ${error.message}`));
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
	SELECTED_AGENT_IDS_KEY,
};
