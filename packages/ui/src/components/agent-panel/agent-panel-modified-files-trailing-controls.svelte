<script lang="ts">
	import { Button } from "../button/index.js";
	import { CaretDown, Check, CheckCircle, FileCode } from "phosphor-svelte";
	import { Colors } from "../../lib/colors.js";

	import type { AgentPanelModifiedFilesTrailingModel } from "./types.js";

	interface Props {
		model: AgentPanelModifiedFilesTrailingModel;
		isExpanded: boolean;
		onToggle?: () => void;
	}

	let { model, isExpanded, onToggle }: Props = $props();

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

<button
	type="button"
	class="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground tabular-nums text-[0.6875rem] transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
	onclick={(event: MouseEvent) => { event.stopPropagation(); onToggle?.(); }}
>
	{model.reviewedCount}/{model.totalCount}
	<CaretDown
		size={12}
		weight="bold"
		class="shrink-0 transition-transform {isExpanded ? 'rotate-180' : ''}"
	/>
</button>
