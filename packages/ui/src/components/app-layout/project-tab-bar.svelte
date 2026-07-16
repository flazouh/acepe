<script lang="ts">
	import HugeiconsIcon from "../icons/hugeicons-icon.svelte";
	import {
		computeProjectBadgeLabels,
		ProjectLetterBadge,
	} from "../project-letter-badge/index.js";

	interface ProjectTab {
		readonly path: string;
		readonly name: string;
		readonly color: string;
		readonly iconSrc?: string | null;
		readonly badgeLabel?: string | null;
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
	const labelByPath = $derived(
		computeProjectBadgeLabels(
			projects.map((project) => ({ key: project.path, name: project.name }))
		)
	);
</script>

{#if projects.length > 0}
	<div
		class="flex w-fit max-w-full shrink-0 items-stretch overflow-hidden rounded-lg border border-border/50 bg-card/75 p-0.5"
		role="tablist"
		aria-label="Projects"
	>
		<div class="flex min-w-0 items-stretch gap-0.5 overflow-x-auto">
			{#each projects as project (project.path)}
				{@const isActive = project.path === activeProjectPath}
				<div
					class="group/project-tab relative flex min-w-0 items-stretch overflow-hidden rounded-lg border border-border/60 transition-all duration-150 {isActive
						? 'border-border bg-accent/45 text-foreground opacity-100'
						: 'bg-accent/30 text-muted-foreground opacity-50 hover:border-border hover:bg-accent/45 hover:text-foreground hover:opacity-100 focus-within:opacity-100'}"
				>
					<button
						type="button"
						role="tab"
						aria-selected={isActive}
						class="flex min-w-0 items-center gap-1.5 rounded-lg py-1 pl-2 text-xs transition-colors cursor-pointer {project.sessionCount != null
							? 'pr-1'
							: 'pr-2'}"
						onclick={() => onSelectProject(project.path)}
						title={project.name}
					>
						<ProjectLetterBadge
							name={project.name}
							label={project.badgeLabel ?? labelByPath.get(project.path) ?? null}
							color={project.color}
							iconSrc={project.iconSrc ?? null}
							size={14}
							class="shrink-0"
						/>
						<span class="truncate max-w-[160px]">{project.name}</span>
					</button>
					{#if project.sessionCount != null && onCreateSession}
						<button
							type="button"
							class="group/session-count relative my-1 mr-2 inline-flex h-4 min-w-4 shrink-0 items-center justify-center self-center rounded bg-foreground/10 px-1 text-[10px] leading-none text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
							aria-label="New session in {project.name}"
							title="New session in {project.name}"
							onclick={(event) => {
								event.stopPropagation();
								onCreateSession(project.path);
							}}
						>
							<span class="transition-opacity duration-150 group-hover/session-count:opacity-0 group-focus-visible/session-count:opacity-0">
								{project.sessionCount}
							</span>
							<HugeiconsIcon
								name="plus"
								size={10}
								class="absolute opacity-0 transition-opacity duration-150 group-hover/session-count:opacity-100 group-focus-visible/session-count:opacity-100"
							/>
						</button>
					{:else if project.sessionCount != null}
						<span
							class="my-1 mr-2 inline-flex h-4 min-w-4 shrink-0 items-center justify-center self-center rounded bg-foreground/10 px-1 text-[10px] leading-none text-muted-foreground"
							aria-label="{project.sessionCount} sessions"
						>
							{project.sessionCount}
						</span>
					{/if}
				</div>
			{/each}
		</div>
	</div>
{/if}
