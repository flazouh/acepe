<script lang="ts">
	import { IconPlus } from "@tabler/icons-svelte";
	import { ProjectLetterBadge } from "../project-letter-badge/index.js";

	interface ProjectTab {
		readonly path: string;
		readonly name: string;
		readonly color: string;
		readonly iconSrc?: string | null;
		readonly sessionCount?: number;
	}

	interface Props {
		projects: readonly ProjectTab[];
		activeProjectPath: string | null;
		onSelectProject: (path: string) => void;
		/** When provided, hovering the session count badge reveals a + to create a new session. */
		onCreateSession?: (path: string) => void;
	}

	let { projects, activeProjectPath, onSelectProject, onCreateSession }: Props = $props();
</script>

{#if projects.length > 0}
	<div
		class="flex w-fit max-w-full shrink-0 items-stretch rounded-lg bg-card px-1 py-1"
		role="tablist"
		aria-label="Projects"
	>
		<div class="flex min-w-0 items-stretch gap-1 overflow-x-auto">
			{#each projects as project (project.path)}
				{@const isActive = project.path === activeProjectPath}
				<div
					class="group/project-tab relative flex min-w-0 items-stretch rounded-md {isActive
						? 'bg-accent text-foreground'
						: 'bg-accent/50 text-muted-foreground hover:bg-accent hover:text-foreground'}"
				>
					<button
						type="button"
						role="tab"
						aria-selected={isActive}
						class="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors cursor-pointer {onCreateSession &&
						project.sessionCount != null
							? 'pr-6'
							: ''}"
						onclick={() => onSelectProject(project.path)}
						title={project.name}
					>
						<ProjectLetterBadge
							name={project.name}
							color={project.color}
							iconSrc={project.iconSrc ?? null}
							size={14}
							class="shrink-0"
						/>
						<span class="truncate max-w-[160px]">{project.name}</span>
						{#if project.sessionCount != null}
							<span
								class="ml-0.5 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded px-1 text-[10px] leading-none text-muted-foreground bg-foreground/10 transition-opacity duration-150 {onCreateSession
									? 'group-hover/project-tab:opacity-0'
									: ''}"
								aria-label="{project.sessionCount} sessions"
							>
								{project.sessionCount}
							</span>
						{/if}
					</button>
					{#if onCreateSession && project.sessionCount != null}
						<button
							type="button"
							class="absolute right-2 top-1/2 flex h-4 min-w-4 -translate-y-1/2 items-center justify-center rounded bg-foreground/10 text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-foreground group-hover/project-tab:opacity-100"
							aria-label="New session in {project.name}"
							onclick={() => onCreateSession(project.path)}
						>
							<IconPlus class="h-2.5 w-2.5" />
						</button>
					{/if}
				</div>
			{/each}
		</div>
	</div>
{/if}
