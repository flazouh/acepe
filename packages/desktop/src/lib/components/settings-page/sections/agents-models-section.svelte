<script lang="ts">
import { Selector } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { CaretDown, Check } from "phosphor-svelte";
import { toast } from "svelte-sonner";
import { PreconnectionCapabilitiesState } from "$lib/acp/components/agent-input/logic/preconnection-capabilities-state.svelte.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import AgentIcon from "$lib/acp/components/agent-icon.svelte";
import * as preferencesStore from "$lib/acp/store/agent-model-preferences-store.svelte.js";
import { getAgentPreferencesStore, getAgentStore } from "$lib/acp/store/index.js";
import { Switch } from "$lib/components/ui/switch/index.js";
import AgentEnvOverridesDialog from "./agent-env-overrides-dialog.svelte";
import {
	applyAgentSelectionChange,
	getAgentsByProviderOrder,
	resolveSettingsProviderMetadata,
	resolveSettingsCapabilitySource,
} from "./agents-models-section.logic.js";
import SettingsSectionHeader from "../settings-section-header.svelte";

const agentStore = getAgentStore();
const agentPreferencesStore = getAgentPreferencesStore();
const logger = createLogger({ id: "settings-agents-models", name: "SettingsAgentsModels" });
const preconnectionCapabilitiesState = new PreconnectionCapabilitiesState();

const capabilitySourceByAgentId = $derived.by(() => {
	const resolutions = new Map();

	for (const agent of agentStore.agents) {
		const providerMetadata = resolveSettingsProviderMetadata({
			agentProviderMetadata: agent.providerMetadata,
			cachedProviderMetadata: preferencesStore.getCachedProviderMetadata(agent.id),
		});
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
		const providerMetadata = resolveSettingsProviderMetadata({
			agentProviderMetadata: agent.providerMetadata,
			cachedProviderMetadata: preferencesStore.getCachedProviderMetadata(agent.id),
		});

		preconnectionCapabilitiesState
			.ensureLoaded({
				agentId: agent.id,
				hasConnectedSession: false,
				projectPath: null,
				preconnectionCapabilityMode: providerMetadata?.preconnectionCapabilityMode ?? "unsupported",
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

<div class="w-full space-y-6">
	<div class="flex items-center justify-between border-b border-border/50 py-2.5">
		<span class="text-[12px] font-medium text-foreground">Default agent</span>
		<Selector align="end" variant="ghost" triggerSize="minimal" showChevron={false}>
			{#snippet renderButton()}
				{#if defaultAgent}
					<AgentIcon agentId={defaultAgent.id} class="size-3.5 shrink-0" size={14} />
					<span class="text-[12px] font-medium text-foreground">{defaultAgent.name}</span>
				{:else}
					<span class="text-[12px] font-medium text-foreground">First available</span>
				{/if}
				<CaretDown class="ml-1 size-2.5 shrink-0 opacity-40" weight="bold" />
			{/snippet}

			<DropdownMenu.Item onclick={() => void agentPreferencesStore.setDefaultAgentId(null)}>
				<div class="flex items-center gap-2">
					<Check
						class={defaultAgentId === null ? "size-3 text-foreground" : "size-3 text-transparent"}
						weight="bold"
					/>
					<span class="text-[12px]">First available</span>
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
						<span class="text-[12px]">{agent.name}</span>
					</div>
				</DropdownMenu.Item>
			{/each}
		</Selector>
	</div>

	<div>
	<div
		class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-border/50 py-2 text-[12px] font-medium text-muted-foreground"
	>
		<span>Agent</span>
		<span class="text-right">Environment</span>
		<span class="w-12 text-right">Enabled</span>
	</div>

	{#each sortedAgents as agent, index (agent.id)}
		{@const isCustomAgent = agentPreferencesStore.customAgentConfigs.some((config) => config.id === agent.id)}
		{@const isEnabled = agentPreferencesStore.selectedAgentIds.includes(agent.id)}

		<div
			class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 py-2.5 {index > 0
				? 'border-t border-border/50'
				: ''}"
		>
			<div class="flex min-w-0 items-center gap-2">
				<AgentIcon agentId={agent.id} class="size-3.5 shrink-0" size={14} />
				<span class="truncate text-[12px] font-medium text-foreground">{agent.name}</span>
			</div>

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

			<div class="flex w-12 justify-end">
				<Switch
					checked={isEnabled}
					onCheckedChange={(checked) => setAgentChecked(agent.id, checked)}
				/>
			</div>
		</div>
	{/each}
	</div>

	{#if agentPreferencesStore.customAgentConfigs.length > 0}
		<div class="space-y-3 pt-2">
			<SettingsSectionHeader
				variant="subsection"
				title={"Persisted custom agents"}
				description="Saved custom agent commands available on this machine."
			/>
			<div
				class="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-2 border-b border-border/50 py-2 text-[12px] font-medium text-muted-foreground"
			>
				<span>Name</span>
				<span>Command</span>
			</div>
			{#each agentPreferencesStore.customAgentConfigs as config, index (config.id)}
				<div
					class="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-2 py-2.5 {index > 0
						? 'border-t border-border/50'
						: ''}"
				>
					<span class="truncate text-[12px] font-medium text-foreground">{config.name}</span>
					<span class="truncate font-mono text-[12px] text-muted-foreground">{config.command}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>
