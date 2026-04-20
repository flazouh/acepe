<script lang="ts">
	import { ProjectLetterBadge } from "@acepe/ui";
	import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
	import { cn } from "$lib/utils.js";
	import SettingsSection from "../settings-section.svelte";
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
	<SettingsSection title="Projects" description="Manage project-scoped settings.">
		<div class="rounded-lg bg-muted/20 px-4 py-6 text-[12px] text-muted-foreground/70 shadow-sm">
			Open a project to configure project settings.
		</div>
	</SettingsSection>
{:else}
	<div class="flex h-full min-h-0 gap-4">
		<nav
			class="flex w-[200px] shrink-0 flex-col gap-px overflow-y-auto rounded-lg bg-muted/20 p-1 shadow-sm"
			aria-label="Projects"
		>
			{#each projects as project (project.path)}
				<button
					type="button"
					onclick={() => (selectedProjectPath = project.path)}
					title={project.path}
					class={cn(
						"flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
						"hover:bg-muted/60 hover:text-foreground",
						activeProjectPath === project.path
							? "bg-muted text-foreground"
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

		<div class="flex-1 min-w-0 min-h-0 overflow-auto">
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
