<script lang="ts">
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { getQuestionStore } from "../store/question-store.svelte.js";
import type { QuestionRequest } from "../types/question";

interface Props {
	question: QuestionRequest;
}

let { question }: Props = $props();

const questionStore = getQuestionStore();

let selectedAnswers: SvelteMap<number, SvelteSet<string>> = new SvelteMap();

function toggleAnswer(questionIndex: number, label: string, multiple?: boolean) {
	const current = selectedAnswers.get(questionIndex) || new SvelteSet<string>();
	const newAnswers = new SvelteSet<string>(multiple ? current : []);

	if (newAnswers.has(label)) {
		newAnswers.delete(label);
	} else {
		if (!multiple) {
			newAnswers.clear();
		}
		newAnswers.add(label);
	}

	selectedAnswers.set(questionIndex, newAnswers);
}

function isSelected(questionIndex: number, label: string): boolean {
	return selectedAnswers.get(questionIndex)?.has(label) ?? false;
}

function handleSubmit() {
	const answers = question.questions.map((_q, index) => ({
		questionIndex: index,
		answers: Array.from(selectedAnswers.get(index) || []),
	}));

	questionStore.reply(question.id, answers, question.questions);
}
</script>

<div class="question-dialog">
	<div class="question-header">
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<circle cx="12" cy="12" r="10" />
			<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
			<line x1="12" y1="17" x2="12.01" y2="17" />
		</svg>
		<span>Question</span>
	</div>

	<div class="question-content">
		{#each question.questions as q, index (q.question)}
			<div class="question-item">
				{#if q.header}
					<div class="question-header-text">{q.header}</div>
				{/if}
				<div class="question-text">{q.question}</div>

				<div class="question-options">
					{#each q.options as option (option.label)}
						<label class="option" class:selected={isSelected(index, option.label)}>
							<input
								type={q.multiSelect ? "checkbox" : "radio"}
								name={`question-${index}`}
								checked={isSelected(index, option.label)}
								onchange={() => toggleAnswer(index, option.label, q.multiSelect)}
							/>
							<span class="option-label">{option.label}</span>
							{#if option.description}
								<span class="option-description">{option.description}</span>
							{/if}
						</label>
					{/each}
				</div>
			</div>
		{/each}
	</div>

	<div class="question-actions">
		<button class="btn secondary" onclick={() => questionStore.cancel(question.id)}>
			Cancel
		</button>
		<button class="btn primary" onclick={handleSubmit}>Submit</button>
	</div>
</div>

<style>
	.question-dialog {
		background: var(--background);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 16px;
		max-width: 500px;
		max-height: 80vh;
		overflow-y: auto;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	}

	.question-header {
		display: flex;
		align-items: center;
		gap: 8px;
		font-weight: 600;
		font-size: 14px;
		margin-bottom: 16px;
		color: var(--foreground);
	}

	.question-header svg {
		color: var(--info);
	}

	.question-content {
		margin-bottom: 16px;
	}

	.question-item {
		margin-bottom: 16px;
		padding-bottom: 16px;
		border-bottom: 1px solid var(--border);
	}

	.question-item:last-child {
		margin-bottom: 0;
		padding-bottom: 0;
		border-bottom: none;
	}

	.question-header-text {
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--muted-foreground);
		margin-bottom: 4px;
	}

	.question-text {
		font-size: 14px;
		font-weight: 500;
		margin-bottom: 12px;
		color: var(--foreground);
	}

	.question-options {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.option {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 10px 12px;
		border: 1px solid var(--border);
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.option:hover {
		background: var(--muted);
	}

	.option.selected {
		border-color: var(--border);
		background: transparent;
	}

	.option input {
		margin-top: 2px;
		flex-shrink: 0;
	}

	.option-label {
		font-weight: 500;
		font-size: 13px;
		color: var(--foreground);
	}

	.option-description {
		display: block;
		font-size: 12px;
		color: var(--muted-foreground);
		margin-top: 2px;
	}

	.question-actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
	}

	.btn {
		padding: 8px 16px;
		border-radius: 6px;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
		border: 1px solid var(--border);
		background: var(--background);
		color: var(--foreground);
	}

	.btn:hover {
		background: var(--muted);
	}

	.btn.primary {
		background: var(--primary);
		border-color: var(--primary);
		color: var(--primary-foreground);
	}

	.btn.primary:hover {
		background: var(--primary-hover);
	}

	.btn.secondary {
		background: var(--secondary);
		border-color: var(--secondary-border);
		color: var(--secondary-foreground);
	}

	.btn.secondary:hover {
		background: var(--secondary-hover);
	}
</style>
