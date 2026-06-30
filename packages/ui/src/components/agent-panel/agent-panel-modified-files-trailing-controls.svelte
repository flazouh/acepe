<script lang="ts">
	import { Button } from "../button/index.js";
	import { CaretDown, FileCode } from "phosphor-svelte";

	import type { AgentPanelModifiedFilesTrailingModel } from "./types.js";

	interface Props {
		model: AgentPanelModifiedFilesTrailingModel;
		isExpanded: boolean;
		onToggle?: () => void;
		showActions?: boolean;
		showToggle?: boolean;
		compactActions?: boolean;
	}

	let {
		model,
		isExpanded,
		onToggle,
		showActions = true,
		showToggle = true,
		compactActions = false,
	}: Props = $props();

	const reviewDisabled = $derived(!model.onReview || model.totalCount === 0);
</script>

{#if showActions}
	<div
		class="flex shrink-0 items-center {compactActions ? 'gap-1' : 'gap-3'}"
		role="none"
		onclick={(event: MouseEvent) => event.stopPropagation()}
	>
		<Button
			variant="headerAction"
			size="headerAction"
			disabled={reviewDisabled}
			onclick={() => model.onReview?.()}
		>
			<FileCode size={11} weight="fill" class="shrink-0" />
			{model.reviewLabel}
		</Button>
	</div>
{/if}

{#if showToggle}
	<Button
		variant="headerAction"
		size="headerAction"
		class="tabular-nums"
		onclick={(event: MouseEvent) => {
			event.stopPropagation();
			onToggle?.();
		}}
	>
		{model.reviewedCount}/{model.totalCount}
		<CaretDown size={12} weight="regular" class="size-3 shrink-0 transition-transform {isExpanded ? 'rotate-180' : ''}"
		/>
	</Button>
{/if}
