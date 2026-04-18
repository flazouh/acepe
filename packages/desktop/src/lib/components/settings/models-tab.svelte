<script lang="ts">
import { PlanIcon } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { IconCircleCheckFilled } from "@tabler/icons-svelte";
import { Check } from "phosphor-svelte";
import ClaudeCodeIcon from "$lib/acp/components/claude-code-icon.svelte";
import CodexIcon from "$lib/acp/components/codex-icon.svelte";
import CursorIcon from "$lib/acp/components/cursor-icon.svelte";
import OpenCodeIcon from "$lib/acp/components/opencode-icon.svelte";
import * as preferencesStore from "$lib/acp/store/agent-model-preferences-store.svelte.js";
import type { ModeType } from "$lib/acp/types/agent-model-preferences.js";
import { CanonicalModeId } from "$lib/acp/types/canonical-mode-id.js";
import { Colors } from "$lib/acp/utils/colors.js";
import { Button } from "$lib/components/ui/button/index.js";
import * as m from "$lib/messages.js";

const AGENTS = ["opencode", "cursor", "claude-code", "codex"];

let selectedDefaults = $state<Record<string, Record<ModeType, string>>>({});

$effect(() => {
	const newSelectedDefaults: Record<string, Record<ModeType, string>> = {};
	for (const agentId of AGENTS) {
		newSelectedDefaults[agentId] = {
			[CanonicalModeId.PLAN]: preferencesStore.getDefaultModel(agentId, CanonicalModeId.PLAN) ?? "",
			[CanonicalModeId.BUILD]:
				preferencesStore.getDefaultModel(agentId, CanonicalModeId.BUILD) ?? "",
		};
	}
	selectedDefaults = newSelectedDefaults;
});

function handleDefaultChange(agentId: string, mode: ModeType, modelId: string) {
	preferencesStore.setDefaultModel(agentId, mode, modelId);
	if (!selectedDefaults[agentId]) {
		selectedDefaults[agentId] = {
			[CanonicalModeId.PLAN]: "",
			[CanonicalModeId.BUILD]: "",
		};
	}
	selectedDefaults[agentId][mode] = modelId;
}

function handleClearDefault(agentId: string, mode: ModeType) {
	preferencesStore.setDefaultModel(agentId, mode, undefined);
	if (selectedDefaults[agentId]) {
		selectedDefaults[agentId][mode] = "";
	}
}

function getAgentDisplayName(agentId: string): string {
	switch (agentId) {
		case "opencode":
			return "OpenCode";
		case "cursor":
			return "Cursor";
		case "claude-code":
			return "Claude Code";
		case "codex":
			return "Codex";
		default:
			return agentId;
	}
}

function getAgentIcon(agentId: string) {
	switch (agentId) {
		case "opencode":
			return OpenCodeIcon;
		case "cursor":
			return CursorIcon;
		case "claude-code":
			return ClaudeCodeIcon;
		case "codex":
			return CodexIcon;
		default:
			return null;
	}
}

interface Props {
	embedded?: boolean;
}
let { embedded = false }: Props = $props();
</script>

<div class="flex flex-col h-full text-[13px]">
	{#if !embedded}
		<div class="mb-3 shrink-0">
			<h2 class="text-[13px] font-semibold text-foreground">
				{m.settings_models_defaults()}
			</h2>
			<p class="text-[12px] text-muted-foreground mt-0.5">
				{m.settings_models_defaults_description()}
			</p>
		</div>
	{/if}

	<div class="flex-1 min-h-0 overflow-auto rounded-lg bg-muted/20 shadow-sm">
		{#each AGENTS as agentId (agentId)}
			{@const cachedModels = preferencesStore.getCachedModels(agentId)}
			{@const AgentIcon = getAgentIcon(agentId)}

			<!-- Agent header -->
			<div
				class="flex items-center gap-2 px-3 h-8 bg-muted/20 border-b border-border/40 sticky top-0"
			>
				{#if AgentIcon}
					<AgentIcon class="size-3.5" />
				{/if}
				<span class="text-[13px] font-semibold text-foreground">
					{getAgentDisplayName(agentId)}
				</span>
			</div>

			<!-- Mode rows -->
			{#each [CanonicalModeId.PLAN, CanonicalModeId.BUILD] as mode (mode)}
				{@const modeType = mode as ModeType}
				{@const currentDefault = selectedDefaults[agentId]?.[modeType] ?? ""}
				<div
					class="flex items-center gap-3 px-3 h-9 border-b border-border/40 last:border-b-0 hover:bg-muted/30 transition-colors"
				>
					<!-- Mode label -->
					<div class="flex items-center gap-1.5 w-16 shrink-0">
						<span
							class={modeType === CanonicalModeId.PLAN ? "text-[color:var(--plan-icon)]" : "text-success"}
						>
							{#if modeType === CanonicalModeId.PLAN}
								<PlanIcon size="lg" class="size-3.5 text-current" />
							{:else}
								<IconCircleCheckFilled class="size-3.5 text-current" />
							{/if}
						</span>
						<span class="text-[13px] font-medium text-muted-foreground">
							{modeType === CanonicalModeId.PLAN ? "Plan" : "Build"}
						</span>
					</div>

					<!-- Model picker -->
					<div class="flex-1 min-w-0">
						{#if cachedModels.length > 0}
							{@const selectedModel = cachedModels.find((model) => model.id === currentDefault)}
							<DropdownMenu.Root>
								<DropdownMenu.Trigger>
									{#snippet child({ props })}
										<Button
											variant="outline"
											class="h-7 w-full justify-between text-left text-[13px]"
											{...props}
										>
											<span class="truncate">{selectedModel?.name ?? "Not set"}</span>
										</Button>
									{/snippet}
								</DropdownMenu.Trigger>
								<DropdownMenu.Content align="start" class="w-[320px]">
									<DropdownMenu.Item onclick={() => handleClearDefault(agentId, modeType)}>
										<div class="flex items-center gap-2">
											<Check
												class={currentDefault === "" ? "size-3.5 text-foreground" : "size-3.5 text-transparent"}
												weight="bold"
											/>
											<span class="text-[13px]">No default</span>
										</div>
									</DropdownMenu.Item>
									<DropdownMenu.Separator />
									{#each cachedModels as model (model.id)}
										<DropdownMenu.Item onclick={() => handleDefaultChange(agentId, modeType, model.id)}>
											<div class="flex min-w-0 items-center gap-2">
												<Check
													class={model.id === currentDefault
														? "size-3.5 text-foreground"
														: "size-3.5 text-transparent"}
													weight="bold"
												/>
												<div class="min-w-0">
													<div class="truncate text-[13px]">{model.name}</div>
													{#if model.description}
														<div class="truncate text-[12px] text-muted-foreground">{model.description}</div>
													{/if}
												</div>
											</div>
										</DropdownMenu.Item>
									{/each}
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						{:else}
							<span class="text-[12px] text-muted-foreground/40">
								{m.settings_models_no_cache()}
							</span>
						{/if}
					</div>
				</div>
			{/each}
		{/each}
	</div>
</div>
