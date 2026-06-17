<script lang="ts">
import { ProjectLetterBadge } from "@acepe/ui";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import { cn } from "$lib/utils.js";
import ProjectSettingsForm from "./project/project-settings-form.svelte";

interface Props {
	projectManager: ProjectManager;
}

let { projectManager }: Props = $props();

let selectedProjectPath = $state<string | null>(null);

const projects = $derived(projectManager.projects);
const activeProjectPath = $derived(selectedProjectPath ?? projects[0]?.path ?? null);
const activeProject = $derived(
	activeProjectPath
		? (projects.find((project) => project.path === activeProjectPath) ?? null)
		: null
);
</script>

{#if projects.length === 0}
	<p class="text-[12px] text-muted-foreground/70">
		Open a project to configure project settings.
	</p>
{:else}
	<div class="flex h-full min-h-0 gap-4">
		<nav
			class="flex w-[200px] shrink-0 flex-col gap-0.5 overflow-y-auto pr-2"
			aria-label="Projects"
		>
			{#each projects as project (project.path)}
				<button
					type="button"
					onclick={() => (selectedProjectPath = project.path)}
					title={project.path}
					class={cn(
						"flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium transition-colors",
						"hover:bg-accent hover:text-foreground",
						activeProjectPath === project.path
							? "bg-accent text-foreground"
							: "text-muted-foreground"
					)}
				>
					<ProjectLetterBadge
						name={project.name}
						color={project.color}
						iconSrc={project.iconPath}
						size={20}
						fontSize={11}
						class="shrink-0"
					/>
					<span class="truncate text-[12px] font-medium leading-4">{project.name}</span>
				</button>
			{/each}
		</nav>

		<div class="min-h-0 min-w-0 flex-1 overflow-auto">
			{#if activeProjectPath && activeProject}
				{#key activeProjectPath}
					<ProjectSettingsForm
						{projectManager}
						projectPath={activeProjectPath}
						projectName={activeProject.name}
					/>
				{/key}
			{/if}
		</div>
	</div>
{/if}
