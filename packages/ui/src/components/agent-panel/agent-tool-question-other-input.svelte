<script lang="ts">
	import { Check, DotsThree } from "phosphor-svelte";
	import { shouldStopQuestionOtherKey } from "./agent-tool-question-state.js";

	interface Props {
		questionIndex: number;
		multiSelect?: boolean;
		text?: string;
		placeholder?: string;
		onOtherInput?: (questionIndex: number, text: string, multiSelect?: boolean) => void;
		onOtherKeydown?: (questionIndex: number, key: string, multiSelect?: boolean) => void;
	}

	let {
		questionIndex,
		multiSelect,
		text = "",
		placeholder = "Other...",
		onOtherInput,
		onOtherKeydown,
	}: Props = $props();

	const hasText = $derived(text.trim().length > 0);

	function handleKeydown(event: KeyboardEvent): void {
		if (shouldStopQuestionOtherKey(event.key)) {
			event.preventDefault();
			event.stopPropagation();
		}

		onOtherKeydown?.(questionIndex, event.key, multiSelect);
	}
</script>

<div class="flex items-center gap-2 px-2 py-1.5 rounded-sm bg-muted/50 overflow-hidden">
	<div class="flex items-center gap-2 w-full">
		{#if hasText}
			<Check size={14} class="text-foreground shrink-0" />
		{:else}
			<DotsThree size={14} weight="bold" class="text-muted-foreground shrink-0" />
		{/if}
		<input
			type="text"
			class="flex-1 px-2 py-1 text-sm rounded-sm border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
			{placeholder}
			value={text}
			oninput={(event) => onOtherInput?.(questionIndex, event.currentTarget.value, multiSelect)}
			onkeydown={handleKeydown}
		/>
		<kbd
			aria-label="Press Enter to submit"
			class="pointer-events-none inline-flex h-5 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background/70 px-1.5 text-sm"
		>
			Enter
		</kbd>
	</div>
</div>
