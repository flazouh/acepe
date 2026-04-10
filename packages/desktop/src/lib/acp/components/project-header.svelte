<script lang="ts">
import { ProjectLetterBadge } from "@acepe/ui";
import { CaretDown } from "phosphor-svelte";
import type { Snippet } from "svelte";

import type { Project } from "../logic/project-manager.svelte.js";
import { TAG_COLORS } from "../utils/colors.js";
import { capitalizeName } from "../utils/index.js";

interface Props {
	/** Project object containing name and color */
	project?: Project | null;
	/** Alternative: direct project name */
	projectName?: string;
	/** Alternative: direct project color hex value */
	projectColor?: string;
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
	const name = project?.name ? project.name : projectName ? projectName : "Unknown Project";
	return capitalizeName(name);
});

/**
 * Get the resolved color for the project.
 * Priority: project.color -> projectColor prop -> default
 */
const fallbackColor = TAG_COLORS.length > 0 ? TAG_COLORS[0] : "#FF5D5A";
const resolvedColor = $derived(
	project?.color ? project.color : projectColor ? projectColor : fallbackColor
);
</script>

<div
	class="shrink-0 flex items-center {expanded ? 'border-b border-border/50' : ''} {className}"
>
	<div class="inline-flex items-center justify-center h-7 w-7 shrink-0">
		<ProjectLetterBadge name={displayName} color={resolvedColor} size={16} />
	</div>
	<div
		class="flex items-center flex-1 min-w-0 h-7 pl-2.5 pr-2 cursor-pointer hover:bg-accent/50 transition-colors"
	>
		<span class="text-[11px] font-medium font-mono text-foreground truncate">{displayName}</span>
		<CaretDown
			class="h-3 w-3 shrink-0 text-muted-foreground ml-auto transition-transform duration-200 {expanded
				? 'rotate-180'
				: ''}"
			weight="bold"
		/>
	</div>
	{#if trailing}
		<div
			class="flex items-center border-l border-border/50"
			role="presentation"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			{@render trailing()}
		</div>
	{/if}
	{#if actions}
		<div class="flex items-center border-l border-border/50">
			{@render actions()}
		</div>
	{/if}
</div>
