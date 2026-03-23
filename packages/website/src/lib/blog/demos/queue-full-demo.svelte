<script lang="ts">
	/**
	 * Demo: Full Attention Queue
	 * Shows all 5 queue states in a single comprehensive demo.
	 */
	import { SectionedFeed, ActivityEntry, TAG_COLORS } from '@acepe/ui';
	import type {
		SectionedFeedGroup,
		ActivityEntryTodoProgress,
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
		readonly todoProgress: ActivityEntryTodoProgress | null;
		readonly question: {
			readonly question: string;
			readonly multiSelect: boolean;
			readonly options: readonly { label: string; description?: string }[];
		} | null;
		readonly projectName: string;
		readonly projectColor: string;
	}

	// Answer Needed item
	const answerNeededItem: DemoItem = {
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
			options: [
				{ label: 'JWT tokens', description: 'Stateless token-based auth' },
				{ label: 'Session cookies', description: 'Server-side session management' },
				{ label: 'OAuth 2.0', description: 'Third-party authentication' }
			]
		},
		projectName: 'Demo',
		projectColor: TAG_COLORS[0]
	};

	// Error item
	const errorItem: DemoItem = {
		id: 'ci-demo',
		title: 'CI pipeline fix',
		mode: 'build',
		timeAgo: '8m',
		insertions: 0,
		deletions: 0,
		isStreaming: false,
		statusText: 'Build failed: missing environment variable',
		showStatusShimmer: false,
		fileToolDisplayText: null,
		toolContent: null,
		showToolShimmer: false,
		taskSubagentSummaries: [],
		showTaskSubagentList: false,
		todoProgress: null,
		question: null,
		projectName: 'Backend',
		projectColor: TAG_COLORS[1]
	};

	// Working item
	const workingItem: DemoItem = {
		id: 'api-demo',
		title: 'Refactoring API endpoints',
		mode: 'build',
		timeAgo: '2m',
		insertions: 67,
		deletions: 23,
		isStreaming: true,
		statusText: null,
		showStatusShimmer: false,
		fileToolDisplayText: 'Editing api-routes.ts',
		toolContent: null,
		showToolShimmer: false,
		taskSubagentSummaries: [],
		showTaskSubagentList: false,
		todoProgress: { current: 3, total: 5, label: 'Migrating endpoints' },
		question: null,
		projectName: 'Backend',
		projectColor: TAG_COLORS[3]
	};

	// Planning item
	const planningItem: DemoItem = {
		id: 'arch-demo',
		title: 'Architecture review',
		mode: 'plan',
		timeAgo: '1m',
		insertions: 0,
		deletions: 0,
		isStreaming: true,
		statusText: 'Planning next moves...',
		showStatusShimmer: true,
		fileToolDisplayText: null,
		toolContent: null,
		showToolShimmer: false,
		taskSubagentSummaries: [],
		showTaskSubagentList: false,
		todoProgress: null,
		question: null,
		projectName: 'Frontend',
		projectColor: TAG_COLORS[5]
	};

	// Finished item
	const finishedItem: DemoItem = {
		id: 'db-demo',
		title: 'Database migration',
		mode: 'build',
		timeAgo: '12m',
		insertions: 34,
		deletions: 8,
		isStreaming: false,
		statusText: 'Complete',
		showStatusShimmer: false,
		fileToolDisplayText: null,
		toolContent: null,
		showToolShimmer: false,
		taskSubagentSummaries: [],
		showTaskSubagentList: false,
		todoProgress: { current: 4, total: 4, label: 'Complete' },
		question: null,
		projectName: 'Backend',
		projectColor: TAG_COLORS[3]
	};

	const groups: readonly SectionedFeedGroup<DemoItem>[] = [
		{
			id: 'answer_needed',
			label: 'Input Needed',
			items: [answerNeededItem]
		},
		{
			id: 'error',
			label: 'Error',
			items: [errorItem]
		},
		{
			id: 'working',
			label: 'Working',
			items: [workingItem]
		},
		{
			id: 'planning',
			label: 'Planning',
			items: [planningItem]
		},
		{
			id: 'finished',
			label: 'Finished',
			items: [finishedItem]
		}
	];

	let selectedItemId = $state<string | null>(null);
	let selectedAnswers = $state<Map<string, string>>(new Map());

	function getQuestionOptions(item: DemoItem): readonly ActivityEntryQuestionOption[] {
		if (!item.question) return [];

		return item.question.options.map((opt, i) => ({
			label: opt.label,
			selected: selectedAnswers.get(item.id) === opt.label,
			color: TAG_COLORS[i % TAG_COLORS.length]
		}));
	}

	function handleAnswerChange(itemId: string, optionLabel: string) {
		selectedAnswers.set(itemId, optionLabel);
		selectedAnswers = new Map(selectedAnswers);
	}
</script>

<div class="demo-container">
	<p class="demo-hint">
		This is a live attention queue showing all 5 states. Try clicking on the answer options in the
		top item!
	</p>

	<SectionedFeed
		{groups}
		totalCount={5}
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
				currentQuestionAnswered={selectedAnswers.has(item.id)}
				currentAnswerDisplay={selectedAnswers.get(item.id) || ''}
				currentQuestionOptions={getQuestionOptions(item)}
				otherText={''}
				otherPlaceholder={''}
				showSubmitButton={false}
				canSubmit={false}
				submitLabel={''}
				onOptionSelect={(optionLabel) => handleAnswerChange(item.id, optionLabel)}
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
