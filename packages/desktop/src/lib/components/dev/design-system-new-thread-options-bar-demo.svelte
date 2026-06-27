<script lang="ts">
	import { AgentInputNewThreadOptions } from "@acepe/ui/agent-panel";

	import AgentSelector from "$lib/acp/components/agent-selector.svelte";
	import ProjectSelector from "$lib/acp/components/project-selector.svelte";
	import type { Project } from "$lib/acp/logic/project-manager.svelte.js";

	import {
		mockAgents,
		mockProjects,
	} from "./design-system-new-thread-options-specimens.js";

	interface Props {
		selectedProject?: Project;
		selectedAgentId?: string;
		worktreeOn?: boolean;
		showWorktree?: boolean;
		showBranch?: boolean;
		onProjectChange?: (project: Project) => void;
		onAgentChange?: (agentId: string) => void;
		onWorktreeToggle?: (on: boolean) => void;
	}

	let {
		selectedProject = mockProjects[0],
		selectedAgentId = "codex",
		worktreeOn = false,
		showWorktree = true,
		showBranch = false,
		onProjectChange,
		onAgentChange,
		onWorktreeToggle,
	}: Props = $props();
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

{#snippet branchControl()}
	<button
		type="button"
		class="flex shrink-0 items-center gap-1 rounded-md bg-transparent px-1.5 py-1 text-xs leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
	>
		<span class="font-mono">main</span>
	</button>
{/snippet}

<AgentInputNewThreadOptions
	project={projectControl}
	agent={agentControl}
	branch={showBranch ? branchControl : undefined}
	{showWorktree}
	{worktreeOn}
	worktreeDisabled={false}
	onWorktreeToggle={(on) => {
		onWorktreeToggle?.(on);
	}}
/>
