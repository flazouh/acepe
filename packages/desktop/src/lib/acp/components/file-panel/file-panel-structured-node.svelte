<script lang="ts">
import { PlanIcon, HugeiconsIcon } from "@acepe/ui";

import type { StructuredData } from "./format/types.js";
import { buildStructuredNodeDisplayState } from "./file-panel-structured-node-state.js";
import FilePanelStructuredNode from "./file-panel-structured-node.svelte";

interface Props {
	value: StructuredData;
	label?: string | null;
	depth?: number;
	initiallyExpanded?: boolean;
}

let { value, label = null, depth = 0, initiallyExpanded = false }: Props = $props();

let isExpanded = $state(false);
let hasInitializedExpansion = $state(false);

$effect(() => {
	if (!hasInitializedExpansion) {
		isExpanded = initiallyExpanded;
		hasInitializedExpansion = true;
	}
});

const nodeState = $derived.by(() => {
	return buildStructuredNodeDisplayState({ value, label, depth });
});
</script>

<div class="structured-node" style={`padding-left: ${nodeState.leftPadding};`}>
	<div class="structured-card {nodeState.isContainer ? 'container-card' : 'leaf-card'}">
		{#if nodeState.isExpandable}
			<button
				type="button"
				class="structured-card-header"
				onclick={() => {
					isExpanded = !isExpanded;
				}}
			>
				<span class="inline-flex w-4 shrink-0 items-center justify-center text-muted-foreground/80" aria-hidden="true">
					{#if isExpanded}
						<HugeiconsIcon name="chevron-down" class="size-3 shrink-0" />
					{:else}
						<HugeiconsIcon name="chevron-right" class="size-3 shrink-0" />
					{/if}
				</span>
				<span class="structured-type-icon" aria-hidden="true">
					{#if nodeState.isArray}
						<PlanIcon size="md" />
					{:else}
						<HugeiconsIcon name="folder" class="h-3.5 w-3.5 text-violet-500" />
					{/if}
				</span>
				<span class="structured-key">{nodeState.keyPrefix}</span>
				<span class="structured-summary">{nodeState.containerSummary}</span>
			</button>

			{#if isExpanded}
				<div class="structured-card-content">
					{#each nodeState.entries as entry (entry.key)}
						<FilePanelStructuredNode value={entry.value} label={entry.key} depth={depth + 1} />
					{/each}
				</div>
			{/if}
		{:else if nodeState.isContainer}
			<div class="structured-card-header">
				<span class="inline-flex w-4 shrink-0 items-center justify-center text-muted-foreground/80" aria-hidden="true">
					{#if nodeState.isArray}
						<PlanIcon size="md" />
					{:else}
						<HugeiconsIcon name="folder" class="h-3.5 w-3.5 text-violet-500" />
					{/if}
				</span>
				<span class="structured-key">{nodeState.keyPrefix}</span>
				<span class="structured-summary">{nodeState.containerSummary}</span>
			</div>
		{:else}
			<div class="structured-card-header">
				<span class="inline-flex w-4 shrink-0 items-center justify-center text-muted-foreground/80" aria-hidden="true">
					{#if typeof nodeState.displayValue === "boolean" && nodeState.displayValue}
						<HugeiconsIcon name="check-circle" class="h-3.5 w-3.5 text-emerald-500" />
					{:else}
						<HugeiconsIcon name="circle-dashed" class="h-3.5 w-3.5 text-muted-foreground" />
					{/if}
				</span>
				<span class="structured-key">{nodeState.keyPrefix}</span>
				<span class="structured-summary" style={nodeState.primitiveStyle || undefined}
					>{nodeState.containerSummary}</span
				>
			</div>
		{/if}
	</div>
</div>

<style>
	.structured-node {
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace);
		font-size: 0.8125rem;
		line-height: 1.45;
		padding-top: 0.2rem;
		padding-bottom: 0.2rem;
	}

	.structured-card {
		border: 1px solid color-mix(in srgb, var(--border) 65%, transparent);
		border-radius: 0.5rem;
		background: color-mix(in srgb, var(--muted) 14%, transparent);
		overflow: hidden;
	}

	.container-card {
		background: color-mix(in srgb, var(--muted) 18%, transparent);
	}

	.leaf-card {
		background: color-mix(in srgb, var(--background) 95%, transparent);
	}

	.structured-card-header {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
		padding: 0.45rem 0.55rem;
		background: none;
		border: 0;
		color: inherit;
		text-align: left;
	}

	button.structured-card-header {
		cursor: pointer;
	}

	button.structured-card-header:hover {
		background: color-mix(in srgb, var(--muted) 35%, transparent);
	}

	.structured-type-icon {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
	}

	.structured-key {
		color: color-mix(in srgb, var(--foreground) 95%, transparent);
		font-weight: 600;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.structured-summary {
		margin-left: auto;
		color: var(--muted-foreground);
		font-size: 0.72rem;
		overflow-wrap: anywhere;
	}

	.structured-card-content {
		padding: 0.2rem 0.4rem 0.45rem;
		border-top: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
		background: color-mix(in srgb, var(--background) 65%, transparent);
	}
</style>
