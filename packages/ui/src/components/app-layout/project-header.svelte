<script lang="ts">
	import type { Snippet } from "svelte";

	import { TAG_COLORS } from "../../lib/colors.js";
	import { HugeiconsIcon } from "../icons/index.js";
	import { ProjectLetterBadge } from "../project-letter-badge/index.js";
	import { SIDEBAR_PROJECT_HEADER_PADDING_X_CLASS } from "./sidebar-tree-row-classes.js";

	interface Props {
		projectName?: string;
		projectBadgeLabel?: string | null;
		projectColor?: string;
		projectIconSrc?: string | null;
		expanded?: boolean;
		class?: string;
		trailing?: Snippet;
		actions?: Snippet;
	}

	let {
		projectName,
		projectBadgeLabel = null,
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
	const badgeSizePx = 16;
</script>

<div
	class="group shrink-0 flex items-center {SIDEBAR_PROJECT_HEADER_PADDING_X_CLASS} transition-colors hover:bg-accent/30 {className}"
	data-testid="project-header"
>
	<!-- Fixed badge-sized surface: icon and expand chevron share the same 16×16 slot. -->
	<div
		class="relative inline-flex size-4 shrink-0 items-center justify-center"
		data-testid="project-header-leading"
		aria-hidden="true"
	>
		<span
			class="absolute inset-0 flex items-center justify-center transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0"
			data-testid="project-header-badge"
		>
			<ProjectLetterBadge
				name={displayName}
				label={projectBadgeLabel}
				color={resolvedColor}
				iconSrc={resolvedIconSrc}
				size={badgeSizePx}
			/>
		</span>
		<span
			class="absolute inset-0 flex items-center justify-center text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
			data-testid="project-header-chevron"
		>
			<HugeiconsIcon
				name="chevron-right"
				size={badgeSizePx}
				class="size-4 shrink-0 transition-transform duration-150 {expanded ? 'rotate-90' : ''}"
			/>
		</span>
	</div>
	<div
		class="flex items-center flex-1 min-w-0 h-7 pl-1.5 cursor-pointer transition-colors"
	>
		<span class="truncate font-normal text-foreground transition-colors">
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
