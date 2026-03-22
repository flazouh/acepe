<script lang="ts">
import CaretDown from "phosphor-svelte/lib/CaretDown";
import CaretRight from "phosphor-svelte/lib/CaretRight";

import {
	isStructuredContainer,
	type StructuredData,
	toStructuredEntries,
} from "./file-panel-format.js";
import FilePanelStructuredNavNode from "./file-panel-structured-nav-node.svelte";

interface Props {
	value: StructuredData;
	label: string | null;
	depth: number;
	currentPath: string[];
	selectedPath: string[];
	onSelect: (path: string[]) => void;
	initiallyExpanded?: boolean;
}

let {
	value,
	label,
	depth,
	currentPath,
	selectedPath,
	onSelect,
	initiallyExpanded = false,
}: Props = $props();

const isContainer = $derived(isStructuredContainer(value));
const entries = $derived.by(() => {
	if (!isContainer) return [];
	return toStructuredEntries(value);
});
const isExpandable = $derived(isContainer && entries.length > 0);

let isExpanded = $state(false);
let hasInitialized = $state(false);

$effect(() => {
	if (!hasInitialized) {
		isExpanded = initiallyExpanded;
		hasInitialized = true;
	}
});

const isSelected = $derived(
	currentPath.length === selectedPath.length &&
		currentPath.every((seg, i) => seg === selectedPath[i])
);

const displayLabel = $derived.by(() => {
	if (label === null) return "/";
	if (/^\d+$/.test(label)) return `[${label}]`;
	return label;
});

const leftPadding = $derived(`${depth * 12 + 8}px`);

function handleClick() {
	if (isExpandable) {
		isExpanded = !isExpanded;
	}
	onSelect(currentPath);
}

function handleKeyDown(e: KeyboardEvent) {
	if (e.key === "Enter" || e.key === " ") {
		e.preventDefault();
		handleClick();
	}
}
</script>

<div
	class="nav-item {isSelected ? 'nav-item-selected' : ''}"
	style={`padding-left: ${leftPadding};`}
	role="button"
	tabindex="0"
	onclick={handleClick}
	onkeydown={handleKeyDown}
>
	<span class="nav-caret">
		{#if isExpandable}
			{#if isExpanded}
				<CaretDown class="h-3 w-3" weight="bold" />
			{:else}
				<CaretRight class="h-3 w-3" weight="bold" />
			{/if}
		{/if}
	</span>
	<span class="nav-label">{displayLabel}</span>
</div>

{#if isExpanded && isContainer}
	{#each entries as entry (entry.key)}
		<FilePanelStructuredNavNode
			value={entry.value}
			label={entry.key}
			depth={depth + 1}
			currentPath={[...currentPath, entry.key]}
			{selectedPath}
			{onSelect}
		/>
	{/each}
{/if}

<style>
	.nav-item {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding-top: 0.3rem;
		padding-bottom: 0.3rem;
		padding-right: 0.5rem;
		cursor: pointer;
		user-select: none;
		color: var(--muted-foreground);
		font-size: 0.8125rem;
		font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
		line-height: 1.45;
	}

	.nav-item:hover {
		background: color-mix(in srgb, var(--muted) 40%, transparent);
		color: var(--foreground);
	}

	.nav-item-selected {
		background: color-mix(in srgb, var(--accent) 25%, transparent);
		color: var(--foreground);
	}

	.nav-caret {
		display: flex;
		align-items: center;
		width: 1rem;
		flex-shrink: 0;
		color: color-mix(in srgb, var(--muted-foreground) 70%, transparent);
	}

	.nav-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
