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
import CaretDown from "phosphor-svelte/lib/CaretDown";
import Check from "phosphor-svelte/lib/Check";
import { toast } from "svelte-sonner";
import AgentIcon from "$lib/acp/components/agent-icon.svelte";
import * as preferencesStore from "$lib/acp/store/agent-model-preferences-store.svelte.js";
import { getAgentPreferencesStore, getAgentStore } from "$lib/acp/store/index.js";
import type { ModeType } from "$lib/acp/types/agent-model-preferences.js";
import { CanonicalModeId } from "$lib/acp/types/canonical-mode-id.js";
import CircularProgress from "$lib/components/ui/circular-progress/circular-progress.svelte";
import { Switch } from "$lib/components/ui/switch/index.js";
import * as m from "$lib/paraglide/messages.js";

import AgentEnvOverridesDialog from "./agent-env-overrides-dialog.svelte";
import { applyAgentSelectionChange } from "./agents-models-section.logic.js";
import SettingsSectionHeader from "../settings-section-header.svelte";

const agentStore = getAgentStore();
const agentPreferencesStore = getAgentPreferencesStore();

const AGENTS_WITH_MODEL_DEFAULTS = new Set(["opencode", "cursor", "claude-code", "codex"]);

let selectedDefaults = $state<Record<string, Record<ModeType, string>>>({});

$effect(() => {
	const next: Record<string, Record<ModeType, string>> = {};
	for (const agent of agentStore.agents) {
		if (AGENTS_WITH_MODEL_DEFAULTS.has(agent.id)) {
			next[agent.id] = {
				[CanonicalModeId.PLAN]:
					preferencesStore.getDefaultModel(agent.id, CanonicalModeId.PLAN) ?? "",
				[CanonicalModeId.BUILD]:
					preferencesStore.getDefaultModel(agent.id, CanonicalModeId.BUILD) ?? "",
			};
		}
	}
	selectedDefaults = next;
});

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
	if (!selectedDefaults[agentId]) {
		selectedDefaults[agentId] = {
			[CanonicalModeId.PLAN]: "",
			[CanonicalModeId.BUILD]: "",
		};
	}
	selectedDefaults[agentId][mode] = modelId;
}

function handleClearDefault(agentId: string, mode: ModeType): void {
	preferencesStore.setDefaultModel(agentId, mode, undefined);
	if (selectedDefaults[agentId]) {
		selectedDefaults[agentId][mode] = "";
	}
}
</script>

<div class="w-full space-y-3">
	<SettingsSectionHeader
		title="Agents & Models"
		description="Choose which agents are enabled and set their default models."
	/>
	{#each agentStore.agents as agent (agent.id)}
		{@const isInstallable = agent.availability_kind?.kind === "installable"}
		{@const isInstallingNow = agentStore.isInstalling(agent.id)}
		{@const installProgress = agentStore.installing[agent.id]}
		{@const hasModelDefaults = AGENTS_WITH_MODEL_DEFAULTS.has(agent.id)}
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
					{#if !agent.available && !isInstallable}
						<span class="ml-1.5 shrink-0 text-[12px] text-muted-foreground/30">
							{m.settings_agents_not_installed()}
						</span>
					{/if}
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
					{#if isInstallingNow && installProgress}
						<div class="flex items-center gap-1.5 h-7 px-2">
							<CircularProgress
								current={installProgress.progress}
								total={1}
								size={12}
								strokeWidth={1.5}
								class="text-muted-foreground"
							/>
							<span class="text-[12px] text-muted-foreground/60">{installProgress.stage}</span>
						</div>
					{:else if isInstallable && !agent.available}
						<span class="h-7 flex items-center px-2 text-[12px] text-muted-foreground/30">
							{m.settings_agents_not_installed()}
						</span>
					{/if}
					<div class="flex items-center h-7 px-1.5" data-header-control>
						<Switch
							checked={agentPreferencesStore.selectedAgentIds.includes(agent.id)}
							onCheckedChange={(checked) => setAgentChecked(agent.id, checked)}
						/>
					</div>
				</HeaderActionCell>
			</EmbeddedPanelHeader>

			{#if hasModelDefaults}
				<div class="grid grid-cols-2 h-7">
					{#each [CanonicalModeId.PLAN, CanonicalModeId.BUILD] as mode (mode)}
						{@const modeType = mode as ModeType}
						{@const cachedModels = preferencesStore.getCachedModels(agent.id)}
						{@const currentDefault = selectedDefaults[agent.id]?.[modeType] ?? ""}
						{@const selectedModel = cachedModels.find((md) => md.id === currentDefault)}
						{@const isPlan = modeType === CanonicalModeId.PLAN}

						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								{#snippet child({ props })}
									<button
										{...props}
										type="button"
										class="flex items-center gap-1.5 h-7 w-full px-2.5 text-muted-foreground hover:bg-accent/50 transition-colors {isPlan ? 'border-r border-border/30' : ''}"
									>
											{#if isPlan}
												<PlanIcon size="sm" class="shrink-0 opacity-60" />
											{:else}
												<BuildIcon size="sm" class="shrink-0 opacity-60" />
											{/if}
											<span class="truncate text-[13px] font-medium text-foreground/70">
												{selectedModel?.name ?? (cachedModels.length > 0 ? "Agent default" : "\u2014")}
											</span>
											{#if cachedModels.length > 0}
												<CaretDown class="size-2.5 shrink-0 opacity-40 ml-auto" weight="bold" />
											{/if}
										</button>
									{/snippet}
								</DropdownMenu.Trigger>
								{#if cachedModels.length > 0}
									<DropdownMenu.Content align="start" class="w-[280px]">
										<DropdownMenu.Item
											onclick={() => handleClearDefault(agent.id, modeType)}
										>
											<div class="flex items-center gap-2">
												<Check
													class={currentDefault === ""
														? "size-3 text-foreground"
														: "size-3 text-transparent"}
													weight="bold"
												/>
												<span class="text-[13px]">Agent default</span>
											</div>
										</DropdownMenu.Item>
										<DropdownMenu.Separator />
										{#each cachedModels as model (model.id)}
											<DropdownMenu.Item
												onclick={() =>
													handleDefaultChange(agent.id, modeType, model.id)}
											>
												<div class="flex min-w-0 items-center gap-2">
													<Check
														class={model.id === currentDefault
															? "size-3 text-foreground"
															: "size-3 text-transparent"}
														weight="bold"
													/>
													<div class="min-w-0">
														<div class="truncate text-[13px]">{model.name}</div>
														{#if model.description}
															<div
																class="truncate text-[12px] text-muted-foreground/50"
															>
																{model.description}
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
			{/if}
		</AgentToolCard>
	{/each}

	<!-- Custom agents -->
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
						<span class="truncate text-[13px] font-medium text-foreground/80"
							>{config.name}</span
						>
						<span class="ml-auto truncate text-[12px] text-muted-foreground/40"
							>{config.command}</span
						>
					</div>
				{/each}
			</AgentToolCard>
		</div>
	{/if}
</div>
