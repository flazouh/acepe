<script lang="ts">
	import type { KanbanQuestionData } from "./types.js";

	interface Props {
		question: KanbanQuestionData;
		onSelectOption: (index: number) => void;
		onSubmit: () => void;
	}

	let { question, onSelectOption, onSubmit }: Props = $props();

	const OPTION_COLORS = ["#9858FF", "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#EC4899"] as const;

	function handleOptionClick(e: MouseEvent, index: number) {
		e.stopPropagation();
		onSelectOption(index);
	}

	function handleSubmit(e: MouseEvent) {
		e.stopPropagation();
		onSubmit();
	}
</script>

<div class="mt-1.5 border-t border-border/40 pt-1.5" data-testid="kanban-question-footer">
	<div class="flex flex-col gap-1">
		<span class="text-[10px] font-medium text-muted-foreground">{question.questionText}</span>
		<div class="flex flex-wrap gap-1">
			{#each question.options as option, i}
				{@const color = OPTION_COLORS[i % OPTION_COLORS.length]}
				<button
					class="rounded-sm px-1.5 py-0.5 text-[10px] transition-colors"
					class:font-medium={option.selected}
					style="background-color: {option.selected ? color + '30' : 'transparent'}; color: {option.selected ? color : 'var(--muted-foreground)'}; border: 1px solid {option.selected ? color + '60' : 'var(--border)'};"
					onclick={(e) => handleOptionClick(e, i)}
				>
					{option.label}
				</button>
			{/each}
		</div>
		{#if question.canSubmit}
			<button
				class="mt-0.5 rounded-sm bg-primary/20 px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/30 active:bg-primary/40"
				onclick={handleSubmit}
			>
				Submit
			</button>
		{/if}
	</div>
</div>