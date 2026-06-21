<script lang="ts">
	import {
		AgentInputConfigOptionSelector,
		AgentInputNewThreadOptions,
		type AgentInputConfigOption,
	} from "@acepe/ui/agent-panel";

	import AgentSelector from "$lib/acp/components/agent-selector.svelte";
	import ModelSelector from "$lib/acp/components/model-selector.svelte";
	import ProjectSelector from "$lib/acp/components/project-selector.svelte";
	import type { Project } from "$lib/acp/logic/project-manager.svelte.js";

	import {
		mockAgents,
		mockCodexProviderMetadata,
		mockModels,
		mockProjects,
	} from "./design-system-new-thread-options-specimens.js";

	interface Props {
		selectedProject?: Project;
		selectedAgentId?: string;
		selectedModelId?: string;
		reasoningOption?: AgentInputConfigOption | null;
		worktreeOn?: boolean;
		showWorktree?: boolean;
		onProjectChange?: (project: Project) => void;
		onAgentChange?: (agentId: string) => void;
		onModelChange?: (modelId: string) => void | Promise<void>;
		onReasoningChange?: (configId: string, value: string) => void;
		onWorktreeToggle?: (on: boolean) => void;
	}

	let {
		selectedProject = mockProjects[0],
		selectedAgentId = "codex",
		selectedModelId = "gpt-5.5",
		reasoningOption = null,
		worktreeOn = false,
		showWorktree = true,
		onProjectChange,
		onAgentChange,
		onModelChange,
		onReasoningChange,
		onWorktreeToggle,
	}: Props = $props();

	const showReasoning = $derived(reasoningOption !== null);
</script>

{#snippet projectControl()}
	<ProjectSelector
		selectedProject={selectedProject}
		recentProjects={mockProjects}
		showLabel
		onProjectChange={(project) => {
			onProjectChange?.(project);
		}}
	/>
{/snippet}

{#snippet agentControl()}
	<AgentSelector
		availableAgents={mockAgents}
		currentAgentId={selectedAgentId}
		showLabel
		onAgentChange={(agentId) => {
			onAgentChange?.(agentId);
		}}
	/>
{/snippet}

{#snippet modelControl()}
	<ModelSelector
		availableModels={mockModels}
		currentModelId={selectedModelId}
		providerMetadata={mockCodexProviderMetadata}
		compactSetup
		onModelChange={async (modelId) => {
			if (onModelChange) {
				await onModelChange(modelId);
			}
		}}
	/>
{/snippet}

{#snippet reasoningControl()}
	{#if reasoningOption}
		<AgentInputConfigOptionSelector
			configOption={reasoningOption}
			displayMode="barOnly"
			onValueChange={(configId, value) => {
				onReasoningChange?.(configId, value);
			}}
		/>
	{/if}
{/snippet}

<AgentInputNewThreadOptions
	project={projectControl}
	agent={agentControl}
	model={modelControl}
	reasoning={reasoningControl}
	{showReasoning}
	{showWorktree}
	{worktreeOn}
	worktreeDisabled={false}
	onWorktreeToggle={(on) => {
		onWorktreeToggle?.(on);
	}}
/>
