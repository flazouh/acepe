<script lang="ts">
	import type { Snippet } from "svelte";

	import { ProjectLetterBadge } from "../project-letter-badge/index.js";

	interface Props {
		/** Project name for the badge */
		projectName: string;
		/** Resolved hex color for the project */
		projectColor: string;
		/**
		 * Badge placement variant:
		 * - "inline": Badge inside the card on the left (tab bar groups)
		 * - "corner": Badge straddling the top-left corner (panel groups)
		 */
		variant?: "inline" | "corner";
		/** Badge size in px (default: 14 for inline, 20 for corner) */
		badgeSize?: number;
		/** Additional CSS classes for the container */
		class?: string;
		/** Card content */
		children: Snippet;
		/** All projects for focused view — renders multiple badges in the left column */
		allProjects?: Array<{ name: string; color: string; path: string }>;
		/** The active project path (determines which badge is full opacity) */
		activeProjectPath?: string | null;
		/** Callback when a project badge is clicked */
		onSelectProject?: (path: string) => void;
	}

	let {
		projectName,
		projectColor,
		variant = "inline",
		badgeSize,
		class: className = "",
		children,
		allProjects,
		activeProjectPath,
		onSelectProject,
	}: Props = $props();

	const resolvedBadgeSize = $derived(badgeSize ?? (variant === "corner" ? 20 : 16));
	const isFocusedMode = $derived(allProjects != null && allProjects.length > 1);
</script>

{#if variant === "corner"}
	<div
		class="flex flex-row items-stretch gap-0.5 rounded-xl border-[1.5px] p-0.5 {className}"
		style="border-color: color-mix(in srgb, {projectColor} 25%, var(--border));"
	>
		{#if isFocusedMode}
			<!-- Focused mode: all project badges stacked vertically -->
			<div class="shrink-0 flex flex-col gap-1.5 m-1">
				{#each allProjects! as project (project.path)}
					{@const isActive = project.path === activeProjectPath}
					<button
						class="transition-opacity duration-150 rounded-sm {isActive ? 'opacity-100' : 'opacity-50 hover:opacity-100 cursor-pointer'}"
						onclick={() => onSelectProject?.(project.path)}
						title={project.name}
					>
						<ProjectLetterBadge name={project.name} color={project.color} size={resolvedBadgeSize} />
					</button>
				{/each}
			</div>
		{:else}
			<!-- Normal mode: single badge -->
			<div class="shrink-0 self-start m-1">
				<ProjectLetterBadge name={projectName} color={projectColor} size={resolvedBadgeSize} />
			</div>
		{/if}
		{@render children()}
	</div>
{:else}
	<!-- Inline variant: badge + tabs -->
	<div
		class="flex items-stretch self-start rounded-lg border overflow-hidden {className}"
		role="group"
		aria-label="{projectName} tabs"
	>
		<div class="shrink-0 flex items-center justify-center px-1.5">
			<ProjectLetterBadge name={projectName} color={projectColor} size={resolvedBadgeSize} />
		</div>
		<div class="flex min-h-0 items-stretch">
			{@render children()}
		</div>
	</div>
{/if}
