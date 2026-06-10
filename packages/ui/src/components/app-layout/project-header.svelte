<script lang="ts">
	import type { Snippet } from "svelte";

	import { TAG_COLORS } from "../../lib/colors.js";
	import { ProjectLetterBadge } from "../project-letter-badge/index.js";

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
		expanded: _expanded = false,
		class: className = "",
		trailing,
		actions,
	}: Props = $props();

	const displayName = $derived(projectName ? projectName : "Unknown Project");
	const fallbackColor = TAG_COLORS.length > 0 ? TAG_COLORS[0] : "#FF5D5A";
	const resolvedColor = $derived(projectColor ? projectColor : fallbackColor);
	const resolvedIconSrc = $derived(projectIconSrc);
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
	<div
		class="flex items-center flex-1 min-w-0 h-7 pl-2 cursor-pointer rounded-md transition-colors"
	>
		<span class="truncate text-xs font-normal text-foreground transition-colors">
			{displayName}
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
