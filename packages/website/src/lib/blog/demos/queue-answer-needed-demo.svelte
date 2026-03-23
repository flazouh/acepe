<script lang="ts">
	/**
	 * Demo: Answer Needed State
	 * Shows a queue item with a pending question requiring user input.
	 */
	import { SectionedFeed, ActivityEntry, TAG_COLORS, Colors, COLOR_NAMES } from '@acepe/ui';
	import type {
		SectionedFeedGroup,
		ActivityEntryQuestion,
		ActivityEntryQuestionOption
	} from '@acepe/ui';

	interface DemoItem {
		readonly id: string;
		readonly title: string;
		readonly mode: 'build' | 'plan' | null;
		readonly timeAgo: string;
		readonly insertions: number;
		readonly deletions: number;
		readonly isStreaming: boolean;
		readonly statusText: string | null;
		readonly showStatusShimmer: boolean;
		readonly fileToolDisplayText: string | null;
		readonly toolContent: string | null;
		readonly showToolShimmer: boolean;
		readonly taskSubagentSummaries: readonly string[];
		readonly showTaskSubagentList: boolean;
		readonly todoProgress: { current: number; total: number; label: string } | null;
		readonly question: ActivityEntryQuestion | null;
		readonly projectName: string;
		readonly projectColor: string;
	}

	const demoItem: DemoItem = {
		id: 'auth-demo',
		title: 'Implementing authentication module',
		mode: 'build',
		timeAgo: 'now',
		insertions: 0,
		deletions: 0,
		isStreaming: false,
		statusText: null,
		showStatusShimmer: false,
		fileToolDisplayText: null,
		toolContent: null,
		showToolShimmer: false,
		taskSubagentSummaries: [],
		showTaskSubagentList: false,
		todoProgress: null,
		question: {
			question: 'Which authentication strategy should I use?',
			multiSelect: false,
			options: [{ label: 'JWT tokens' }, { label: 'Session cookies' }, { label: 'OAuth 2.0' }]
		},
		projectName: 'Demo',
		projectColor: TAG_COLORS[1]
	};

	const groups: readonly SectionedFeedGroup<DemoItem>[] = [
		{
			id: 'answer_needed',
			label: 'Input Needed',
			items: [demoItem]
		}
	];

	// Interactive state
	let selectedItemId = $state<string | null>(null);
	let selectedAnswers = $state<Set<string>>(new Set());

	const QUESTION_COLORS = [
		Colors[COLOR_NAMES.GREEN],
		Colors[COLOR_NAMES.RED],
		Colors[COLOR_NAMES.PINK],
		Colors[COLOR_NAMES.ORANGE]
	];

	function getQuestionOptions(): readonly ActivityEntryQuestionOption[] {
		if (!demoItem.question) return [];
		return demoItem.question.options.map((opt, i) => ({
			label: opt.label,
			selected: selectedAnswers.has(opt.label),
			color: QUESTION_COLORS[i % QUESTION_COLORS.length]
		}));
	}

	function handleAnswerChange(answerId: string) {
		if (selectedAnswers.has(answerId)) {
			selectedAnswers.delete(answerId);
		} else {
			selectedAnswers = new Set([answerId]);
		}
	}
</script>

<div class="demo-container">
	<p class="demo-hint">
		Try selecting an answer to see how interactive questions work in the attention queue.
	</p>

	<SectionedFeed
		{groups}
		totalCount={1}
	>
		{#snippet itemRenderer(rawItem)}
			{@const item = rawItem as DemoItem}
			{#snippet projectBadge()}
				<span
					class="flex h-4 w-4 items-center justify-center rounded text-[10px] font-medium"
					style="background-color: {item.projectColor}; color: white;"
				>
					{item.projectName.charAt(0)}
				</span>
			{/snippet}
			<ActivityEntry
				selected={selectedItemId === item.id}
				onSelect={() => {
					selectedItemId = item.id;
				}}
				mode={item.mode}
				title={item.title}
				timeAgo={item.timeAgo}
				insertions={item.insertions}
				deletions={item.deletions}
				{projectBadge}
				isStreaming={item.isStreaming}
				taskDescription={null}
				taskSubagentSummaries={item.taskSubagentSummaries}
				showTaskSubagentList={item.showTaskSubagentList}
				fileToolDisplayText={item.fileToolDisplayText}
				toolContent={item.toolContent}
				showToolShimmer={item.showToolShimmer}
				statusText={item.statusText}
				showStatusShimmer={item.showStatusShimmer}
				todoProgress={item.todoProgress}
				currentQuestion={item.question
					? {
							question: item.question.question,
							multiSelect: item.question.multiSelect,
							options: item.question.options.map((o) => ({ label: o.label }))
						}
					: null}
				totalQuestions={item.question ? 1 : 0}
				hasMultipleQuestions={false}
				currentQuestionIndex={0}
				questionId={item.id}
				questionProgress={[]}
				currentQuestionAnswered={false}
				currentAnswerDisplay={''}
				currentQuestionOptions={getQuestionOptions()}
				otherText={''}
				otherPlaceholder={''}
				showSubmitButton={false}
				canSubmit={false}
				submitLabel={''}
				onOptionSelect={(optionLabel) => handleAnswerChange(optionLabel)}
				onOtherInput={() => {}}
				onOtherKeydown={() => {}}
				onSubmitAll={() => {}}
				onNextQuestion={() => {}}
				onPrevQuestion={() => {}}
			/>
		{/snippet}
	</SectionedFeed>
</div>

<style>
	.demo-container {
		max-width: 800px;
		margin: 2rem auto;
		padding: 1.5rem;
		border-radius: 0.5rem;
		border: 1px solid hsl(var(--border) / 0.5);
		background: hsl(var(--card) / 0.3);
	}

	.demo-hint {
		margin-bottom: 1rem;
		padding: 0.75rem;
		border-radius: 0.375rem;
		background: hsl(var(--muted) / 0.5);
		color: hsl(var(--muted-foreground));
		font-size: 0.875rem;
		text-align: center;
	}
</style>
