<script lang="ts">
import { ProjectLetterBadge } from "@acepe/ui";
import CaretDown from "phosphor-svelte/lib/CaretDown";
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
	/** Whether the sidebar is in collapsed (narrow) mode */
	collapsed?: boolean;
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
	collapsed = false,
	class: className = "",
	trailing,
	actions,
}: Props = $props();

/**
 * Get the display name, with fallback logic.
 * Priority: project.name -> projectName prop -> "Unknown Project"
 */
const displayName = $derived.by(() => {
	const name = project?.name || projectName || "Unknown Project";
	return capitalizeName(name);
});

/**
 * Get the resolved color for the project.
 * Priority: project.color -> projectColor prop -> default
 */
const resolvedColor = $derived(project?.color ?? projectColor ?? TAG_COLORS[0] ?? "#FF5D5A");
</script>

{#if collapsed}
	<div
		class="shrink-0 flex flex-col items-center gap-0.5 py-1 {className}"
	>
		<!-- Badge centered -->
		<div class="inline-flex items-center justify-center shrink-0">
			<ProjectLetterBadge name={displayName} color={resolvedColor} size={16} />
		</div>
		<!-- Actions stacked vertically below badge -->
		{#if actions}
			<div class="flex flex-col items-center gap-0">
				{@render actions()}
			</div>
		{/if}
	</div>
{:else}
	<div
		class="shrink-0 flex items-center {expanded ? 'border-b border-border/50' : ''} {className}"
	>
		<!-- Badge cell -->
		<div class="inline-flex items-center justify-center h-7 w-7 shrink-0">
			<ProjectLetterBadge name={displayName} color={resolvedColor} size={16} />
		</div>
		<!-- Name + expand/collapse chevron (fills space) -->
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
		<!-- Trailing (settings) -->
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
		<!-- Right: action buttons separated by border-l -->
		{#if actions}
			<div class="flex items-center border-l border-border/50">
				{@render actions()}
			</div>
		{/if}
	</div>
{/if}
