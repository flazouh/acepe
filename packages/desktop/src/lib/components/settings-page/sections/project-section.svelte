<script lang="ts">
import { ProjectLetterBadge } from "@acepe/ui";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import { projectIconPreview } from "$lib/acp/logic/project-icon-preview.svelte.js";
import { cn } from "$lib/utils.js";
import ProjectIconPicker from "./project/project-icon-picker.svelte";
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
			{#each projects as project (project.id ?? project.path)}
				<button
					type="button"
					onclick={() => (selectedProjectPath = project.path)}
					title={project.path}
					class={cn(
						"flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] font-medium transition-colors",
						"hover:bg-accent hover:text-foreground",
						activeProjectPath === project.path
							? "bg-accent text-foreground"
							: "text-muted-foreground"
					)}
				>
					<ProjectLetterBadge
						name={project.name}
						iconSrc={projectIconPreview(project.iconPath)}
						label={projectManager.getProjectBadgeLabel(project.path) ?? null}
						color={project.color}
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
					<!--
						The icon sits outside ProjectSettingsForm on purpose. That form
						is gated on getProjectAcepeConfig, which is not on the contract
						yet and always fails, so anything inside it renders as an error
						instead of a control.
					-->
					<section class="mb-6 flex flex-col gap-2" data-testid="project-icon-section">
						<div>
							<h3 class="text-[13px] font-medium text-foreground">Icon</h3>
							<p class="text-[11px] text-muted-foreground/70">
								Shown on this project's badge. Pick one of the project's own
								images, or let Acepe find one.
							</p>
						</div>
						<ProjectIconPicker
							{projectManager}
							projectPath={activeProjectPath}
							projectName={activeProject.name}
							projectColor={activeProject.color}
							iconPath={activeProject.iconPath ?? null}
							icon={activeProject.icon ?? { kind: "auto" }}
						/>
					</section>
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
