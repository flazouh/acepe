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
	/** Whether the badge grip should be available for dragging */
	draggable?: boolean;
	/** Called when the badge grip receives pointer down */
	onGripPointerDown?: (event: PointerEvent) => void;
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
	draggable = false,
	onGripPointerDown,
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

function handleGripPointerDown(event: PointerEvent): void {
	event.stopPropagation();
	onGripPointerDown?.(event);
}

function handleGripClick(event: MouseEvent): void {
	event.stopPropagation();
}

function handleGripKeyDown(event: KeyboardEvent): void {
	if (event.key === "Enter" || event.key === " ") {
		event.preventDefault();
		event.stopPropagation();
	}
}
</script>

<div
	class="shrink-0 flex items-center rounded-md {expanded ? 'bg-background/30' : ''} {className}"
>
	<button
		type="button"
		class="inline-flex items-center justify-center h-7 w-7 shrink-0 border-0 bg-transparent p-0"
		tabindex={draggable ? 0 : -1}
		aria-label={draggable ? `Reorder ${displayName}` : undefined}
		onpointerdown={draggable ? handleGripPointerDown : undefined}
		onclick={draggable ? handleGripClick : undefined}
		onkeydown={draggable ? handleGripKeyDown : undefined}
	>
		<ProjectLetterBadge
			name={displayName}
			color={resolvedColor}
			iconSrc={resolvedIconSrc}
			{draggable}
			size={16}
		/>
	</button>
	<div
		class="flex items-center flex-1 min-w-0 h-7 pl-2 pr-2 cursor-pointer rounded-md hover:bg-background/70 transition-colors"
	>
		<span
			class="truncate text-[10px] font-semibold tracking-wide text-muted-foreground/70 transition-colors group-hover:text-foreground/85"
		>
			{displayName}
		</span>
		<CaretDown
			class="ml-auto h-3 w-3 shrink-0 text-muted-foreground/55 transition-transform duration-200 {expanded
				? 'rotate-180'
				: ''}"
			weight="bold"
		/>
	</div>
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
	{#if actions}
		<div class="flex items-center gap-0.5 pr-0.5">
			{@render actions()}
		</div>
	{/if}
</div>
