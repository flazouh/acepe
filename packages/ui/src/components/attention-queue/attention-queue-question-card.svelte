<script lang="ts">
	import IconSquare from "@tabler/icons-svelte/icons/square";
	import IconCheck from "@tabler/icons-svelte/icons/check";
	import IconHelpCircleFilled from "@tabler/icons-svelte/icons/help-circle-filled";
	import CaretRight from "phosphor-svelte/lib/CaretRight";
	import CaretLeft from "phosphor-svelte/lib/CaretLeft";

	import type {
		ActivityEntryQuestion,
		ActivityEntryQuestionOption,
		ActivityEntryQuestionProgress,
	} from "./types.js";

	interface Props {
		currentQuestion: ActivityEntryQuestion;
		totalQuestions: number;
		hasMultipleQuestions: boolean;
		currentQuestionIndex: number;
		questionId: string;
		questionProgress: readonly ActivityEntryQuestionProgress[];
		currentQuestionAnswered: boolean;
		currentQuestionOptions: readonly ActivityEntryQuestionOption[];
		otherText: string;
		otherPlaceholder: string;
		showOtherInput?: boolean;
		showSubmitButton: boolean;
		canSubmit: boolean;
		submitLabel: string;
		onOptionSelect: (optionLabel: string) => void;
		onOtherInput: (value: string) => void;
		onOtherKeydown: (key: string) => void;
		onSubmitAll: () => void;
		onPrevQuestion: () => void;
		onNextQuestion: () => void;
	}

	let {
		currentQuestion,
		totalQuestions,
		hasMultipleQuestions,
		currentQuestionIndex,
		questionId,
		questionProgress,
		currentQuestionAnswered,
		currentQuestionOptions,
		otherText,
		otherPlaceholder,
		showOtherInput = true,
		showSubmitButton,
		canSubmit,
		submitLabel,
		onOptionSelect,
		onOtherInput,
		onOtherKeydown,
		onSubmitAll,
		onPrevQuestion,
		onNextQuestion,
	}: Props = $props();

	const questionIconClassName = $derived(currentQuestionAnswered ? "text-success" : "text-primary");
</script>

<div class="mt-2 flex flex-col overflow-hidden rounded-md border border-border/60 bg-muted/20 shadow-sm">
	<div class="flex items-center gap-1.5 border-b border-border/60 bg-muted/40 px-2 py-1.5">
		<IconHelpCircleFilled class={`size-3.5 shrink-0 ${questionIconClassName}`} />
		<div class="min-w-0 flex-1 text-xs leading-tight font-medium text-foreground">
			{currentQuestion.question}
		</div>

		{#if hasMultipleQuestions}
			<div class="shrink-0 flex items-center gap-0.5">
				<button
					type="button"
					class="rounded p-0.5 hover:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-30"
					disabled={currentQuestionIndex === 0}
					onclick={(e) => {
						e.stopPropagation();
						onPrevQuestion();
					}}
				>
					<CaretLeft class="h-3 w-3 text-muted-foreground" />
				</button>
				<span class="px-0.5 font-mono text-xs tabular-nums text-muted-foreground">
					{currentQuestionIndex + 1}/{totalQuestions}
				</span>
				<button
					type="button"
					class="rounded p-0.5 hover:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-30"
					disabled={currentQuestionIndex === totalQuestions - 1}
					onclick={(e) => {
						e.stopPropagation();
						onNextQuestion();
					}}
				>
					<CaretRight class="h-3 w-3 text-muted-foreground" />
				</button>
			</div>
			<div class="ml-1 flex shrink-0 gap-0.5">
				{#each questionProgress as dot (dot.questionIndex)}
					<div
						class="h-1.5 w-1.5 rounded-full {questionId && dot.answered ? 'bg-primary' : 'bg-muted-foreground/30'}"
					></div>
				{/each}
			</div>
		{/if}
	</div>

	<div class="flex flex-col divide-y divide-border/40 bg-background/20">
		{#if currentQuestion.options.length > 0}
			{#each currentQuestionOptions as option, i (`${option.label}-${i}`)}
				<button
					type="button"
					class="flex items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-all {option.selected
						? 'bg-primary/10 font-medium text-foreground'
						: 'text-foreground/80 hover:bg-muted/50 hover:text-foreground'}"
					onclick={(e) => {
						e.stopPropagation();
						onOptionSelect(option.label);
					}}
				>
					{#if currentQuestion.multiSelect}
						{#if option.selected}
							<div class="flex size-3 shrink-0 items-center justify-center rounded-sm border border-transparent bg-primary text-primary-foreground">
								<IconCheck class="size-2.5" />
							</div>
						{:else}
							<div class="size-3 shrink-0 rounded-sm border border-border/80 bg-background/50"></div>
						{/if}
					{:else}
						{#if option.selected}
							<div class="flex size-3 shrink-0 items-center justify-center rounded-sm border border-transparent bg-primary text-primary-foreground">
								<IconCheck class="size-2.5" />
							</div>
						{:else}
							<IconSquare class="size-3 shrink-0 text-muted-foreground/60" />
						{/if}
					{/if}
					<span>{option.label}</span>
				</button>
			{/each}
		{/if}

		{#if showOtherInput}
			<div class="flex items-center gap-2 px-2.5 py-1.5 text-xs transition-all {otherText.trim() ? 'bg-primary/5' : 'focus-within:bg-muted/30'}">
				<input
					type="text"
					class="w-full flex-1 border-none bg-transparent p-0 outline-none focus:ring-0 {otherText.trim() ? 'font-medium text-foreground' : 'text-foreground/80'} placeholder:text-muted-foreground/60"
					placeholder={otherPlaceholder}
					value={otherText}
					oninput={(e) => {
						e.stopPropagation();
						onOtherInput((e.target as HTMLInputElement).value);
					}}
					onkeydown={(e) => {
						e.stopPropagation();
						onOtherKeydown(e.key);
					}}
					onclick={(e) => e.stopPropagation()}
				/>
				<kbd
					aria-label="Press Enter to submit"
					class="pointer-events-none inline-flex h-5 shrink-0 items-center justify-center rounded border border-border/60 bg-background/70 px-1.5 font-mono text-[10px] text-muted-foreground/80"
				>
					Enter
				</kbd>
			</div>
		{/if}
	</div>

	{#if showSubmitButton}
		<div class="flex items-center justify-end border-t border-border/50 bg-muted/30 px-2 py-1.5">
			<button
				type="button"
				class="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
				disabled={!canSubmit}
				onclick={(e) => {
					e.stopPropagation();
					onSubmitAll();
				}}
			>
				{submitLabel}
			</button>
		</div>
	{/if}
</div>
