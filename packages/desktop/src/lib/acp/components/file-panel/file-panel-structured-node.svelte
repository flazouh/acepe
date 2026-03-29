<script lang="ts">
import { PlanIcon } from "@acepe/ui";
import CaretDown from "phosphor-svelte/lib/CaretDown";
import CaretRight from "phosphor-svelte/lib/CaretRight";
import CheckCircle from "phosphor-svelte/lib/CheckCircle";
import CircleDashed from "phosphor-svelte/lib/CircleDashed";
import Folder from "phosphor-svelte/lib/Folder";
import { Colors } from "$lib/acp/utils/colors.js";

import {
	formatStructuredPrimitive,
	getStructuredContainerSummary,
	isStructuredContainer,
	type StructuredData,
	toStructuredEntries,
	tryParseJsonString,
} from "./file-panel-format.js";
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

const displayValue = $derived.by(() => {
	if (typeof value === "string") {
		const parsed = tryParseJsonString(value);
		return parsed ?? value;
	}
	return value;
});

const isContainer = $derived(isStructuredContainer(displayValue));
const isArray = $derived(isContainer && Array.isArray(displayValue));
const containerSummary = $derived.by(() => {
	if (isContainer) {
		return getStructuredContainerSummary(displayValue);
	}
	return formatStructuredPrimitive(displayValue);
});
const entries = $derived.by(() => {
	if (!isContainer) {
		return [];
	}
	return toStructuredEntries(displayValue);
});
const isExpandable = $derived(isContainer && entries.length > 0);
const leftPadding = $derived(`${depth * 12}px`);
const primitiveStyle = $derived.by(() => {
	if (isContainer) {
		return "";
	}

	if (displayValue === null) {
		return `color: ${Colors.orange}`;
	}

	if (typeof displayValue === "boolean") {
		return `color: ${Colors.purple}`;
	}

	if (typeof displayValue === "number") {
		return `color: ${Colors.cyan}`;
	}

	if (typeof displayValue === "string") {
		return "color: var(--success)";
	}

	return "";
});

const keyPrefix = $derived.by(() => {
	if (label === null) {
		return "root";
	}

	if (typeof label === "string" && /^\d+$/.test(label)) {
		return `[${label}]`;
	}

	return label;
});
</script>

<div class="structured-node" style={`padding-left: ${leftPadding};`}>
	<div class="structured-card {isContainer ? 'container-card' : 'leaf-card'}">
		{#if isExpandable}
			<button
				type="button"
				class="structured-card-header"
				onclick={() => {
					isExpanded = !isExpanded;
				}}
			>
				<span class="structured-chevron" aria-hidden="true">
					{#if isExpanded}
						<CaretDown class="h-3.5 w-3.5" weight="bold" />
					{:else}
						<CaretRight class="h-3.5 w-3.5" weight="bold" />
					{/if}
				</span>
				<span class="structured-type-icon" aria-hidden="true">
					{#if isArray}
						<PlanIcon size="md" />
					{:else}
						<Folder class="h-3.5 w-3.5 text-violet-500" weight="bold" />
					{/if}
				</span>
				<span class="structured-key">{keyPrefix}</span>
				<span class="structured-summary">{containerSummary}</span>
			</button>

			{#if isExpanded}
				<div class="structured-card-content">
					{#each entries as entry (entry.key)}
						<FilePanelStructuredNode value={entry.value} label={entry.key} depth={depth + 1} />
					{/each}
				</div>
			{/if}
		{:else if isContainer}
			<div class="structured-card-header">
				<span class="structured-chevron" aria-hidden="true">
					{#if isArray}
						<PlanIcon size="md" />
					{:else}
						<Folder class="h-3.5 w-3.5 text-violet-500" weight="bold" />
					{/if}
				</span>
				<span class="structured-key">{keyPrefix}</span>
				<span class="structured-summary">{containerSummary}</span>
			</div>
		{:else}
			<div class="structured-card-header">
				<span class="structured-chevron" aria-hidden="true">
					{#if typeof displayValue === "boolean" && displayValue}
						<CheckCircle class="h-3.5 w-3.5 text-emerald-500" weight="fill" />
					{:else}
						<CircleDashed class="h-3.5 w-3.5 text-muted-foreground" weight="bold" />
					{/if}
				</span>
				<span class="structured-key">{keyPrefix}</span>
				<span class="structured-summary" style={primitiveStyle || undefined}
					>{containerSummary}</span
				>
			</div>
		{/if}
	</div>
</div>

<style>
	.structured-node {
		font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
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

	.structured-chevron {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1rem;
		color: color-mix(in srgb, var(--muted-foreground) 80%, transparent);
		flex-shrink: 0;
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
