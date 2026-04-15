<script lang="ts">
	import { Button } from "../button/index.js";
	import { CaretDown, Check, CheckCircle, FileCode } from "phosphor-svelte";
	import { Colors } from "../../lib/colors.js";

	import type { AgentPanelModifiedFilesTrailingModel } from "./types.js";

	interface Props {
		model: AgentPanelModifiedFilesTrailingModel;
		isExpanded: boolean;
	}

	let { model, isExpanded }: Props = $props();

	const reviewDisabled = $derived(!model.onReview || model.totalCount === 0);
</script>

<div role="none" onclick={(event: MouseEvent) => event.stopPropagation()}>
	<Button
		variant="headerAction"
		size="headerAction"
		disabled={reviewDisabled}
		onclick={() => model.onReview?.()}
	>
		<FileCode size={11} weight="fill" class="shrink-0" style="color: {Colors.purple}" />
		{model.reviewLabel}
	</Button>
</div>

<div role="none" onclick={(event: MouseEvent) => event.stopPropagation()}>
	{#if model.keepState === "applied"}
		<Button variant="headerAction" size="headerAction" disabled class="disabled:opacity-100">
			<CheckCircle size={11} weight="fill" class="shrink-0 text-success" />
			{model.appliedLabel ?? "Applied"}
		</Button>
	{:else}
		<Button
			variant="invert"
			size="headerAction"
			disabled={model.keepState === "disabled"}
			onclick={() => model.onKeep?.()}
		>
			<Check size={11} weight="bold" class="shrink-0" />
			{model.keepLabel}
		</Button>
	{/if}
</div>

<span class="text-muted-foreground tabular-nums text-[0.6875rem]">
	{model.reviewedCount}/{model.totalCount}
</span>

<CaretDown
	size={14}
	weight="bold"
	class="size-3.5 text-muted-foreground transition-transform {isExpanded ? 'rotate-180' : ''}"
/>
