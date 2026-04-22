<script lang="ts">
import { BuildIcon, PlanIcon } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { CaretDown, Check } from "phosphor-svelte";
import { toast } from "svelte-sonner";
import type { DisplayableModel, ModelsForDisplay } from "$lib/services/acp-types.js";
import AgentIcon from "$lib/acp/components/agent-icon.svelte";
import * as preferencesStore from "$lib/acp/store/agent-model-preferences-store.svelte.js";
import { getAgentPreferencesStore, getAgentStore } from "$lib/acp/store/index.js";
import type { ModeType } from "$lib/acp/types/agent-model-preferences.js";
import { CanonicalModeId } from "$lib/acp/types/canonical-mode-id.js";
import { Switch } from "$lib/components/ui/switch/index.js";
import AgentEnvOverridesDialog from "./agent-env-overrides-dialog.svelte";
import {
	applyAgentSelectionChange,
	getAgentsByProviderOrder,
	getAgentModelDefaultsEntries,
	getProviderDefaultLabel,
} from "./agents-models-section.logic.js";
import SettingsSectionHeader from "../settings-section-header.svelte";

const agentStore = getAgentStore();
const agentPreferencesStore = getAgentPreferencesStore();

const modelDefaultEntries = $derived.by(() =>
	getAgentModelDefaultsEntries(agentStore.agents, preferencesStore.getCachedModelsDisplay)
);
const sortedAgents = $derived.by(() =>
	getAgentsByProviderOrder(agentStore.agents, preferencesStore.getCachedModelsDisplay)
);

const defaultAgentId = $derived(agentPreferencesStore.defaultAgentId);
const defaultAgent = $derived(
	defaultAgentId ? (agentStore.agents.find((a) => a.id === defaultAgentId) ?? null) : null
);
const selectableAgents = $derived(
	agentStore.agents.filter((a) => agentPreferencesStore.selectedAgentIds.includes(a.id))
);

function setAgentChecked(agentId: string, checked: boolean): void {
	const result = applyAgentSelectionChange(
		agentPreferencesStore.selectedAgentIds,
		agentId,
		checked
	);
	if (!result.ok) {
		toast.error("At least one agent must remain selected.");
		return;
	}
	if (!result.changed) {
		return;
	}

	agentPreferencesStore.setSelectedAgentIds(result.value).match(
		() => undefined,
		(error) => {
			toast.error(error.message);
		}
	);
}

function handleDefaultChange(agentId: string, mode: ModeType, modelId: string): void {
	preferencesStore.setDefaultModel(agentId, mode, modelId);
}

function handleClearDefault(agentId: string, mode: ModeType): void {
	preferencesStore.setDefaultModel(agentId, mode, undefined);
}

function findDisplayModel(
	modelsDisplay: ModelsForDisplay | null,
	modelId: string
): DisplayableModel | null {
	if (!modelsDisplay?.groups) {
		return null;
	}

	for (const group of modelsDisplay.groups) {
		const match = group.models.find((model) => model.modelId === modelId);
		if (match) {
			return match;
		}
	}

	return null;
}

function getModelLabel(
	modelId: string,
	fallbackName: string,
	modelsDisplay: ModelsForDisplay | null
): string {
	return findDisplayModel(modelsDisplay, modelId)?.displayName ?? fallbackName;
}

function getModelDescription(
	modelId: string,
	fallbackDescription: string | undefined,
	modelsDisplay: ModelsForDisplay | null
): string | undefined {
	return findDisplayModel(modelsDisplay, modelId)?.description ?? fallbackDescription;
}
</script>

<div class="w-full space-y-4">
	<SettingsSectionHeader
		title="Agents & Models"
		description="Choose which agents are enabled and set their default models."
	/>

	<!-- Default agent -->
	<div class="overflow-hidden rounded-lg bg-muted/20 shadow-sm">
		<div class="flex items-center justify-between h-9 px-3">
			<span class="text-[13px] font-medium text-foreground">Default agent</span>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<button
							{...props}
							type="button"
							class="flex items-center gap-1.5 h-7 px-2 rounded text-muted-foreground transition-colors hover:bg-accent"
						>
							{#if defaultAgent}
								<AgentIcon agentId={defaultAgent.id} class="size-3.5 shrink-0" size={14} />
								<span class="text-[13px] font-medium text-foreground">{defaultAgent.name}</span>
							{:else}
								<span class="text-[13px] font-medium text-foreground">First available</span>
							{/if}
							<CaretDown class="size-2.5 shrink-0 opacity-40 ml-1" weight="bold" />
						</button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="w-[220px]">
					<DropdownMenu.Item onclick={() => void agentPreferencesStore.setDefaultAgentId(null)}>
						<div class="flex items-center gap-2">
							<Check
								class={defaultAgentId === null ? "size-3 text-foreground" : "size-3 text-transparent"}
								weight="bold"
							/>
							<span class="text-[13px]">First available</span>
						</div>
					</DropdownMenu.Item>
					<DropdownMenu.Separator />
					{#each selectableAgents as agent (agent.id)}
						<DropdownMenu.Item onclick={() => void agentPreferencesStore.setDefaultAgentId(agent.id)}>
							<div class="flex items-center gap-2">
								<Check
									class={agent.id === defaultAgentId ? "size-3 text-foreground" : "size-3 text-transparent"}
									weight="bold"
								/>
								<AgentIcon agentId={agent.id} class="size-3.5 shrink-0" size={14} />
								<span class="text-[13px]">{agent.name}</span>
							</div>
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>
	</div>

	<!-- Agents table -->
	<div class="overflow-hidden rounded-lg bg-muted/20 shadow-sm">
		<!-- Header row -->
		<div
			class="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-center gap-2 h-8 px-3 border-b border-border/40 text-[12px] font-medium text-muted-foreground"
		>
			<span>Agent</span>
			<span class="flex items-center gap-1">
				<PlanIcon size="sm" class="shrink-0 opacity-60" />
				Plan model
			</span>
			<span class="flex items-center gap-1">
				<BuildIcon size="sm" class="shrink-0 opacity-60" />
				Build model
			</span>
			<span class="text-right">Environment</span>
			<span class="w-12 text-right">Enabled</span>
		</div>

		{#each sortedAgents as agent, index (agent.id)}
			{@const entry = modelDefaultEntries.find((candidate) => candidate.agent.id === agent.id) ?? null}
			{@const providerMetadata = entry?.providerMetadata ?? agent.providerMetadata ?? null}
			{@const hasModelDefaults = providerMetadata?.supportsModelDefaults ?? false}
			{@const isCustomAgent = agentPreferencesStore.customAgentConfigs.some((config) => config.id === agent.id)}
			{@const isEnabled = agentPreferencesStore.selectedAgentIds.includes(agent.id)}

			<div
				class="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-center gap-2 h-9 px-3 {index > 0 ? 'border-t border-border/40' : ''}"
			>
				<!-- Agent cell -->
				<div class="flex items-center gap-2 min-w-0">
					<AgentIcon agentId={agent.id} class="size-3.5 shrink-0" size={14} />
					<span class="truncate text-[13px] font-medium text-foreground">{agent.name}</span>
				</div>

				<!-- Plan / Build cells -->
				{#each [CanonicalModeId.PLAN, CanonicalModeId.BUILD] as mode (mode)}
					{@const modeType = mode as ModeType}
					{@const cachedModels = hasModelDefaults ? preferencesStore.getCachedModels(agent.id) : []}
					{@const cachedModelsDisplay = preferencesStore.getCachedModelsDisplay(agent.id)}
					{@const currentDefault = preferencesStore.getDefaultModel(agent.id, modeType) ?? ""}
					{@const selectedModel = cachedModels.find((model) => model.id === currentDefault)}
					{@const selectedModelLabel = selectedModel
						? getModelLabel(selectedModel.id, selectedModel.name, cachedModelsDisplay)
						: null}
					{@const fallbackLabel = providerMetadata ? getProviderDefaultLabel(providerMetadata) : ""}

					<div class="min-w-0">
						{#if hasModelDefaults && providerMetadata}
							<DropdownMenu.Root>
								<DropdownMenu.Trigger disabled={cachedModels.length === 0}>
									{#snippet child({ props })}
										<button
											{...props}
											type="button"
											disabled={cachedModels.length === 0}
											class="flex items-center gap-1.5 h-7 w-full px-2 rounded text-muted-foreground transition-colors {cachedModels.length === 0 ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent'}"
										>
											<span class="truncate text-[13px] text-foreground">
												{selectedModelLabel ?? (cachedModels.length > 0 ? fallbackLabel : "No cache")}
											</span>
											{#if cachedModels.length > 0}
												<CaretDown class="size-2.5 shrink-0 opacity-40 ml-auto" weight="bold" />
											{/if}
										</button>
									{/snippet}
								</DropdownMenu.Trigger>
								{#if cachedModels.length > 0}
									<DropdownMenu.Content align="start" class="w-[280px]">
										<DropdownMenu.Item onclick={() => handleClearDefault(agent.id, modeType)}>
											<div class="flex items-center gap-2">
												<Check
													class={currentDefault === "" ? "size-3 text-foreground" : "size-3 text-transparent"}
													weight="bold"
												/>
												<span class="text-[13px]">{fallbackLabel}</span>
											</div>
										</DropdownMenu.Item>
										<DropdownMenu.Separator />
										{#each cachedModels as model (model.id)}
											{@const modelLabel = getModelLabel(model.id, model.name, cachedModelsDisplay)}
											{@const modelDescription = getModelDescription(model.id, model.description, cachedModelsDisplay)}
											<DropdownMenu.Item onclick={() => handleDefaultChange(agent.id, modeType, model.id)}>
												<div class="flex min-w-0 items-center gap-2">
													<Check
														class={model.id === currentDefault ? "size-3 text-foreground" : "size-3 text-transparent"}
														weight="bold"
													/>
													<div class="min-w-0">
														<div class="truncate text-[13px]">{modelLabel}</div>
														{#if modelDescription}
															<div class="truncate text-[12px] text-muted-foreground">{modelDescription}</div>
														{/if}
													</div>
												</div>
											</DropdownMenu.Item>
										{/each}
									</DropdownMenu.Content>
								{/if}
							</DropdownMenu.Root>
						{:else}
							<span class="text-[12px] text-muted-foreground">—</span>
						{/if}
					</div>
				{/each}

				<!-- Environment cell -->
				<div class="flex justify-end">
					{#if !isCustomAgent}
						<AgentEnvOverridesDialog
							agentId={agent.id}
							agentName={agent.name}
							value={agentPreferencesStore.getAgentEnvOverrides(agent.id)}
							onSave={(env) => {
								agentPreferencesStore.setAgentEnvOverrides(agent.id, env).match(
									() => {
										toast.success(`${agent.name} environment saved`);
									},
									(error) => {
										toast.error(error.message);
									}
								);
							}}
						/>
					{:else}
						<span class="text-[12px] text-muted-foreground">—</span>
					{/if}
				</div>

				<!-- Enabled cell -->
				<div class="w-12 flex justify-end">
					<Switch
						checked={isEnabled}
						onCheckedChange={(checked) => setAgentChecked(agent.id, checked)}
					/>
				</div>
			</div>
		{/each}
	</div>

	{#if agentPreferencesStore.customAgentConfigs.length > 0}
		<div class="pt-1 space-y-2">
			<SettingsSectionHeader
				title={"Persisted custom agents"}
				description="Saved custom agent commands available on this machine."
			/>
			<div class="overflow-hidden rounded-lg bg-muted/20 shadow-sm">
				<div
					class="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-2 h-8 px-3 border-b border-border/40 text-[12px] font-medium text-muted-foreground"
				>
					<span>Name</span>
					<span>Command</span>
				</div>
				{#each agentPreferencesStore.customAgentConfigs as config, index (config.id)}
					<div
						class="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-2 h-8 px-3 {index > 0 ? 'border-t border-border/40' : ''}"
					>
						<span class="truncate text-[13px] font-medium text-foreground">{config.name}</span>
						<span class="truncate text-[12px] text-muted-foreground font-mono">{config.command}</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
