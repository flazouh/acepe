<script lang="ts">
import { ProjectLetterBadge } from "@acepe/ui";
import { CaretDown } from "phosphor-svelte";
import type { Snippet } from "svelte";

import type { Project } from "../logic/project-manager.svelte.js";
import { TAG_COLORS } from "../utils/colors.js";

interface Props {
	/** Project object containing name and color */
	project?: Project | null;
	/** Alternative: direct project name */
	projectName?: string;
	/** Alternative: direct project color hex value */
	projectColor?: string;
	/** Alternative: direct project icon source */
	projectIconSrc?: string | null;
	/** Whether the project card is expanded */
	expanded?: boolean;
	/** Additional CSS classes */
	class?: string;
	/** Optional content to render after the project name (e.g. settings menu) */
	trailing?: Snippet;
	/** Optional actions to render at the end (view toggle, terminal, plus, etc.) */
	actions?: Snippet;
}

let {
	project,
	projectName,
	projectColor,
	projectIconSrc = null,
	expanded = false,
	class: className = "",
	trailing,
	actions,
}: Props = $props();

/**
 * Get the display name, with fallback logic.
 * Priority: project.name -> projectName prop -> "Unknown Project"
 */
const displayName = $derived.by(() => {
	return project?.name ? project.name : projectName ? projectName : "Unknown Project";
});

/**
 * Get the resolved color for the project.
 * Priority: project.color -> projectColor prop -> default
 */
const fallbackColor = TAG_COLORS.length > 0 ? TAG_COLORS[0] : "#FF5D5A";
const resolvedColor = $derived(
	project?.color ? project.color : projectColor ? projectColor : fallbackColor
);
const resolvedIconSrc = $derived(project?.iconPath ?? projectIconSrc);
</script>

<div class="shrink-0 flex items-center rounded-md bg-card px-1 {className}">
	<div class="inline-flex items-center justify-center h-7 shrink-0">
		<ProjectLetterBadge
			name={displayName}
			color={resolvedColor}
			iconSrc={resolvedIconSrc}
			size={16}
		/>
	</div>
	<div class="flex items-center flex-1 min-w-0 h-7 pl-2 cursor-pointer rounded-md transition-colors">
		<span
			class="truncate text-[10px] font-semibold tracking-wide text-muted-foreground/70 transition-colors"
		>
			{displayName}
		</span>
	</div>
	{#if actions}
		<div class="flex items-center">
			{@render actions()}
		</div>
	{/if}
	<button
		type="button"
		class="flex items-center justify-center size-5 shrink-0 rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
		aria-label={expanded ? "Collapse project" : "Expand project"}
	>
		<CaretDown
			class="h-3 w-3 transition-transform duration-200 {expanded ? 'rotate-180' : ''}"
			weight="bold"
		/>
	</button>
	{#if trailing}
		<div
			class="flex items-center gap-0.5"
			role="presentation"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			{@render trailing()}
		</div>
	{/if}
</div>
