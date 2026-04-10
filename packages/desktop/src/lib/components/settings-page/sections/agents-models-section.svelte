<script lang="ts">
import { BuildIcon, PlanIcon } from "@acepe/ui";
import { AgentToolCard } from "@acepe/ui/agent-panel";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import {
	EmbeddedPanelHeader,
	HeaderActionCell,
	HeaderCell,
	HeaderTitleCell,
} from "@acepe/ui/panel-header";
import { CaretDown } from "phosphor-svelte";
import { Check } from "phosphor-svelte";
import { toast } from "svelte-sonner";
import type { DisplayableModel, ModelsForDisplay } from "$lib/services/acp-types.js";
import AgentIcon from "$lib/acp/components/agent-icon.svelte";
import * as preferencesStore from "$lib/acp/store/agent-model-preferences-store.svelte.js";
import { getAgentPreferencesStore, getAgentStore } from "$lib/acp/store/index.js";
import type { ModeType } from "$lib/acp/types/agent-model-preferences.js";
import { CanonicalModeId } from "$lib/acp/types/canonical-mode-id.js";
import { Switch } from "$lib/components/ui/switch/index.js";
import * as m from "$lib/paraglide/messages.js";

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

function setAgentChecked(agentId: string, checked: boolean): void {
	const result = applyAgentSelectionChange(
		agentPreferencesStore.selectedAgentIds,
		agentId,
		checked
	);
	if (!result.ok) {
		toast.error(m.settings_agents_min_one());
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

<div class="w-full space-y-3">
<SettingsSectionHeader
title="Agents & Models"
description="Choose which agents are enabled and set their default models."
/>
	{#each sortedAgents as agent (agent.id)}
{@const entry = modelDefaultEntries.find((candidate) => candidate.agent.id === agent.id) ?? null}
{@const providerMetadata = entry?.providerMetadata ?? agent.providerMetadata ?? null}
{@const hasModelDefaults = providerMetadata?.supportsModelDefaults ?? false}
{@const isCustomAgent = agentPreferencesStore.customAgentConfigs.some((config) => config.id === agent.id)}

<AgentToolCard variant="muted">
<EmbeddedPanelHeader class={hasModelDefaults ? '' : '!border-b-0'}>
<HeaderCell withDivider={false}>
<AgentIcon agentId={agent.id} class="size-3.5 shrink-0" size={14} />
</HeaderCell>
<HeaderTitleCell compactPadding>
<span class="truncate text-[13px] font-semibold text-foreground">
{agent.name}
</span>
</HeaderTitleCell>
<HeaderActionCell withDivider>
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
{/if}
<div class="flex items-center h-7 px-1.5" data-header-control>
<Switch
checked={agentPreferencesStore.selectedAgentIds.includes(agent.id)}
onCheckedChange={(checked) => setAgentChecked(agent.id, checked)}
/>
</div>
</HeaderActionCell>
</EmbeddedPanelHeader>

{#if hasModelDefaults && providerMetadata && entry}
<div class="grid grid-cols-2 h-7">
{#each [CanonicalModeId.PLAN, CanonicalModeId.BUILD] as mode (mode)}
{@const modeType = mode as ModeType}
{@const cachedModels = preferencesStore.getCachedModels(agent.id)}
{@const cachedModelsDisplay = preferencesStore.getCachedModelsDisplay(agent.id)}
{@const currentDefault = preferencesStore.getDefaultModel(agent.id, modeType) ?? ""}
{@const selectedModel = cachedModels.find((model) => model.id === currentDefault)}
{@const selectedModelLabel = selectedModel
? getModelLabel(selectedModel.id, selectedModel.name, cachedModelsDisplay)
: null}
{@const fallbackLabel = getProviderDefaultLabel(providerMetadata)}
{@const isPlan = modeType === CanonicalModeId.PLAN}

<DropdownMenu.Root>
<DropdownMenu.Trigger disabled={cachedModels.length === 0}>
{#snippet child({ props })}
<button
{...props}
type="button"
disabled={cachedModels.length === 0}
class="flex items-center gap-1.5 h-7 w-full px-2.5 text-muted-foreground transition-colors {cachedModels.length === 0 ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent/50'} {isPlan ? 'border-r border-border/30' : ''}"
>
{#if isPlan}
<PlanIcon size="sm" class="shrink-0 opacity-60" />
{:else}
<BuildIcon size="sm" class="shrink-0 opacity-60" />
{/if}
<span class="truncate text-[13px] font-medium text-foreground/70">
{selectedModelLabel ?? (cachedModels.length > 0 ? fallbackLabel : "No cached models")}
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
class={currentDefault === ""
? "size-3 text-foreground"
: "size-3 text-transparent"}
weight="bold"
/>
<span class="text-[13px]">{fallbackLabel}</span>
</div>
</DropdownMenu.Item>
<DropdownMenu.Separator />
{#each cachedModels as model (model.id)}
{@const modelLabel = getModelLabel(model.id, model.name, cachedModelsDisplay)}
{@const modelDescription = getModelDescription(
model.id,
model.description,
cachedModelsDisplay
)}
<DropdownMenu.Item onclick={() => handleDefaultChange(agent.id, modeType, model.id)}>
<div class="flex min-w-0 items-center gap-2">
<Check
class={model.id === currentDefault
? "size-3 text-foreground"
: "size-3 text-transparent"}
weight="bold"
/>
<div class="min-w-0">
<div class="truncate text-[13px]">{modelLabel}</div>
{#if modelDescription}
<div class="truncate text-[12px] text-muted-foreground/50">
{modelDescription}
</div>
{/if}
</div>
</div>
</DropdownMenu.Item>
{/each}
</DropdownMenu.Content>
{/if}
</DropdownMenu.Root>
{/each}
</div>
{:else if hasModelDefaults}
<div class="px-2.5 py-2 text-[12px] text-muted-foreground/50">
Provider metadata unavailable for model defaults.
</div>
{/if}
</AgentToolCard>
{/each}

{#if agentPreferencesStore.customAgentConfigs.length > 0}
<div class="pt-1">
<SettingsSectionHeader
title={m.settings_agents_persisted()}
description="Saved custom agent commands available on this machine."
/>
<AgentToolCard variant="muted">
{#each agentPreferencesStore.customAgentConfigs as config (config.id)}
<div
class="flex items-center h-7 px-2.5 gap-2 border-b border-border/30 last:border-b-0"
>
<span class="truncate text-[13px] font-medium text-foreground/80">{config.name}</span>
<span class="ml-auto truncate text-[12px] text-muted-foreground/40">{config.command}</span>
</div>
{/each}
</AgentToolCard>
</div>
{/if}
</div>
