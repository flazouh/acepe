<script lang="ts">
	import {
		isSelectedProject,
		type LibrarySidebarViewModel,
	} from "./library-sidebar-state.js";

	let {
		model,
		onSelectProject,
	}: {
		model: LibrarySidebarViewModel;
		onSelectProject: (projectId: string) => void;
	} = $props();

	const selectedProject = $derived(
		model.projects.find((project) =>
			isSelectedProject({
				projectId: project.id,
				selectedProjectId: model.selectedProjectId,
			}),
		),
	);
</script>

<nav data-testid="library-sidebar" aria-label={model.projectsHeading} class="flex h-full min-h-0 w-[280px] flex-col gap-3 p-3">
	<section class="flex min-h-0 flex-col gap-1">
		<h1 class="text-xs font-medium text-muted-foreground">{model.projectsHeading}</h1>
		{#if model.projects.length === 0}
			<p data-testid="library-projects-empty" class="text-xs text-muted-foreground">{model.emptyProjectsLabel}</p>
		{:else}
			<ul class="flex flex-col gap-0.5">
				{#each model.projects as project (project.id)}
					<li>
						<button
							type="button"
							data-testid="library-project"
							data-project-id={project.id}
							data-project-state={project.deleted ? "deleted" : "active"}
							class="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs font-medium transition-colors hover:bg-accent/50 {isSelectedProject(
								{
									projectId: project.id,
									selectedProjectId: model.selectedProjectId,
								},
							)
								? 'bg-accent/20'
								: ''}"
							onclick={() => onSelectProject(project.id)}
						>
							<span class="truncate">{project.title}</span>
							{#if project.deletedLabel !== null}
								<span class="shrink-0 text-[10px] text-muted-foreground">{project.deletedLabel}</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="flex min-h-0 flex-1 flex-col gap-1" data-testid="library-sessions">
		<h2 class="text-xs font-medium text-muted-foreground">
			{model.sessionsHeading}{selectedProject ? ` · ${selectedProject.title}` : ""}
		</h2>
		{#if model.selectedProjectId === null || model.sessions.length === 0}
			<p data-testid="library-sessions-empty" class="text-xs text-muted-foreground">{model.emptySessionsLabel}</p>
		{:else}
			<ul class="flex flex-col gap-0.5 overflow-auto">
				{#each model.sessions as session (session.id)}
					<li>
						<div
							data-testid="library-session"
							data-session-id={session.id}
							data-session-state={session.lifecycle}
							class="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs"
						>
							<span class="truncate font-medium">{session.title}</span>
							{#if session.lifecycleLabel !== null}
								<span class="shrink-0 text-[10px] text-muted-foreground">{session.lifecycleLabel}</span>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</nav>
