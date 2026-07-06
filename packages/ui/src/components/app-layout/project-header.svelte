<script lang="ts">
	import type { Snippet } from "svelte";

	import { TAG_COLORS } from "../../lib/colors.js";
	import { RoundedIcon } from "../icons/index.js";
	import { ProjectLetterBadge } from "../project-letter-badge/index.js";
	import { SIDEBAR_PROJECT_HEADER_PADDING_X_CLASS } from "./sidebar-tree-row-classes.js";

	interface Props {
		projectName?: string;
		projectColor?: string;
		projectIconSrc?: string | null;
		expanded?: boolean;
		class?: string;
		trailing?: Snippet;
		actions?: Snippet;
	}

	let {
		projectName,
		projectColor,
		projectIconSrc = null,
		expanded = false,
		class: className = "",
		trailing,
		actions,
	}: Props = $props();

	const displayName = $derived(projectName ? projectName : "Unknown Project");
	const fallbackColor = TAG_COLORS.length > 0 ? TAG_COLORS[0] : "#FF5D5A";
	const resolvedColor = $derived(projectColor ? projectColor : fallbackColor);
	const resolvedIconSrc = $derived(projectIconSrc);
</script>

<div class="shrink-0 flex items-center {SIDEBAR_PROJECT_HEADER_PADDING_X_CLASS} transition-colors hover:bg-accent/30 {className}">
	<div class="inline-flex items-center justify-center h-7 shrink-0">
		<ProjectLetterBadge
			name={displayName}
			color={resolvedColor}
			iconSrc={resolvedIconSrc}
			size={16}
		/>
	</div>
	<div
		class="flex items-center flex-1 min-w-0 h-7 pl-1.5 cursor-pointer transition-colors"
	>
		<span class="truncate font-normal text-foreground transition-colors">
			{displayName}
		</span>
		<span
			class="ml-1 inline-flex shrink-0 items-center text-muted-foreground/60 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
		>
			<RoundedIcon name="chevron-right" class="size-3 shrink-0 transition-transform duration-150 {expanded ? 'rotate-90' : ''}"
			/>
		</span>
	</div>
	{#if actions}
		<div class="flex items-center">
			{@render actions()}
		</div>
	{/if}
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
