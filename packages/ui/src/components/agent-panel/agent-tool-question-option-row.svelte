<script lang="ts">
	import { HugeiconsIcon } from "../icons/index.js";
	import type { AgentQuestionOption } from "./types.js";
	import { getQuestionOptionClasses } from "./agent-tool-question-state.js";

	interface Props {
		option: AgentQuestionOption;
		questionIndex: number;
		multiSelect?: boolean;
		selected?: boolean;
		isInteractive?: boolean;
		onSelect?: (questionIndex: number, label: string, multiSelect?: boolean) => void;
	}

	let {
		option,
		questionIndex,
		multiSelect,
		selected = false,
		isInteractive = false,
		onSelect,
	}: Props = $props();

	const optionClasses = $derived(getQuestionOptionClasses({ selected, isInteractive }));
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class={optionClasses}
	role={isInteractive ? "button" : undefined}
	tabindex={isInteractive ? 0 : -1}
	onclick={() => isInteractive && onSelect?.(questionIndex, option.label, multiSelect)}
	onkeydown={(event) =>
		isInteractive &&
		event.key === "Enter" &&
		onSelect?.(questionIndex, option.label, multiSelect)}
>
	<div class="flex items-start gap-2 w-full">
		{#if multiSelect}
			{#if selected}
				<HugeiconsIcon name="check" class="size-3.5 text-foreground shrink-0 mt-0.5" />
			{:else}
				<span
					class="mt-0.5 size-3.5 shrink-0 rounded-sm border border-muted-foreground/70"
					data-testid="question-option-unselected-square"
				></span>
			{/if}
		{:else if selected}
			<HugeiconsIcon name="check" class="size-3.5 text-foreground shrink-0 mt-0.5" />
		{/if}
		<div class="flex flex-col min-w-0">
			<span class="text-sm">{option.label}</span>
			{#if option.description}
				<span class="mt-0.5 text-sm">{option.description}</span>
			{/if}
		</div>
	</div>
</div>
