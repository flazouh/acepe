<script lang="ts">
import { BuildIcon, PlanIcon } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { CaretDown, Check } from "phosphor-svelte";
import { toast } from "svelte-sonner";
import { PreconnectionCapabilitiesState } from "$lib/acp/components/agent-input/logic/preconnection-capabilities-state.svelte.js";
import { createLogger } from "$lib/acp/utils/logger.js";
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
	resolveSettingsCapabilitySource,
} from "./agents-models-section.logic.js";
import SettingsModelSelector from "./settings-model-selector.svelte";
import SettingsSectionHeader from "../settings-section-header.svelte";

const agentStore = getAgentStore();
const agentPreferencesStore = getAgentPreferencesStore();
const logger = createLogger({ id: "settings-agents-models", name: "SettingsAgentsModels" });
const preconnectionCapabilitiesState = new PreconnectionCapabilitiesState();

const capabilitySourceByAgentId = $derived.by(() => {
	const resolutions = new Map();

	for (const agent of agentStore.agents) {
		const providerMetadata =
			preferencesStore.getCachedProviderMetadata(agent.id) ?? agent.providerMetadata ?? null;
		const preconnectionCapabilities = preconnectionCapabilitiesState.getCapabilities({
			agentId: agent.id,
			projectPath: null,
			preconnectionCapabilityMode: providerMetadata?.preconnectionCapabilityMode ?? "unsupported",
		});

		resolutions.set(
			agent.id,
			resolveSettingsCapabilitySource({
				preconnectionCapabilities,
				cachedModes: preferencesStore.getCachedModes(agent.id),
				cachedModels: preferencesStore.getCachedModels(agent.id),
				cachedModelsDisplay: preferencesStore.getCachedModelsDisplay(agent.id),
				providerMetadata,
			})
		);
	}

	return resolutions;
});

const modelDefaultEntries = $derived.by(() =>
	getAgentModelDefaultsEntries(
		agentStore.agents,
		(agentId) => capabilitySourceByAgentId.get(agentId)?.providerMetadata ?? null
	)
);
const sortedAgents = $derived.by(() =>
	getAgentsByProviderOrder(
		agentStore.agents,
		(agentId) => capabilitySourceByAgentId.get(agentId)?.providerMetadata ?? null
	)
);

const defaultAgentId = $derived(agentPreferencesStore.defaultAgentId);
const defaultAgent = $derived(
	defaultAgentId ? (agentStore.agents.find((a) => a.id === defaultAgentId) ?? null) : null
);
const selectableAgents = $derived(
	agentStore.agents.filter((a) => agentPreferencesStore.selectedAgentIds.includes(a.id))
);

$effect(() => {
	for (const agent of agentStore.agents) {
		preconnectionCapabilitiesState
			.ensureLoaded({
				agentId: agent.id,
				hasConnectedSession: false,
				projectPath: null,
				preconnectionCapabilityMode:
					agent.providerMetadata?.preconnectionCapabilityMode ?? "unsupported",
			})
			.mapErr((error) => {
				logger.error("Failed to warm settings preconnection capabilities", {
					agentId: agent.id,
					error: error.message,
				});
				return undefined;
			});
	}
});

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
			{@const capabilitySource = capabilitySourceByAgentId.get(agent.id) ?? null}
			{@const entry = modelDefaultEntries.find((candidate) => candidate.agent.id === agent.id) ?? null}
			{@const providerMetadata = entry?.providerMetadata ?? capabilitySource?.providerMetadata ?? agent.providerMetadata ?? null}
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
					{@const availableModels = hasModelDefaults ? (capabilitySource?.availableModels ?? []) : []}
					{@const modelsDisplay = capabilitySource?.modelsDisplay ?? null}
					{@const fallbackLabel = providerMetadata ? getProviderDefaultLabel(providerMetadata) : "Default"}
					{@const isModelsLoading = hasModelDefaults &&
						availableModels.length === 0 &&
						preconnectionCapabilitiesState.isLoading({
							agentId: agent.id,
							projectPath: null,
							preconnectionCapabilityMode:
								agent.providerMetadata?.preconnectionCapabilityMode ?? "unsupported",
						})}

					<div class="min-w-0">
						{#if hasModelDefaults && providerMetadata}
							<SettingsModelSelector
								agentId={agent.id}
								{modeType}
								{availableModels}
								{modelsDisplay}
								{fallbackLabel}
								isLoading={isModelsLoading}
							/>
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
