<script lang="ts">
	import { Button } from "../button/index.js";
	import { RoundedIcon } from "../icons/index.js";

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
			variant="secondary"
			size="xs"
			disabled={reviewDisabled}
			onclick={() => model.onReview?.()}
		>
			<RoundedIcon name="code" class="size-[11px] shrink-0" data-testid="modified-files-review-code-icon" />
			{model.reviewLabel}
		</Button>
	</div>
{/if}

{#if showToggle}
	<Button
		variant="secondary"
		size="xs"
		class="tabular-nums"
		onclick={(event: MouseEvent) => {
			event.stopPropagation();
			onToggle?.();
		}}
	>
		{model.reviewedCount}/{model.totalCount}
		<RoundedIcon name="chevron-down" class="size-3 shrink-0 transition-transform {isExpanded ? 'rotate-180' : ''}"
		/>
	</Button>
{/if}
