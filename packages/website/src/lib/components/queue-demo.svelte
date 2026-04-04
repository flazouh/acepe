<script lang="ts">
	/**
	 * Live interactive demo of Acepe's Attention Queue.
	 * Uses the real @acepe/ui components to showcase queue functionality
	 * on the marketing website.
	 */
	import {
		SectionedFeed,
		FeedItem,
		ActivityEntry,
		ProjectLetterBadge,
		COLOR_NAMES,
		Colors,
		TAG_COLORS
	} from '@acepe/ui';
	import type {
		SectionedFeedGroup,
		ActivityEntryMode,
		ActivityEntryQuestion,
		ActivityEntryQuestionOption,
		ActivityEntryQuestionProgress,
		ActivityEntryTodoProgress
	} from '@acepe/ui';

	// =========================================================================
	// TYPES
	// =========================================================================

	interface DemoItem {
		readonly id: string;
		readonly sectionId: 'answer_needed' | 'working' | 'planning' | 'needs_review' | 'error';
		readonly title: string;
		readonly mode: ActivityEntryMode;
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
		readonly question: ActivityEntryQuestion | null;
		readonly projectName: string;
		readonly projectColor: string;
	}

	// =========================================================================
	// DEMO ITEMS - Carefully curated to show feature breadth
	// =========================================================================

	const QUESTION_COLORS = [
		Colors[COLOR_NAMES.GREEN],
		Colors[COLOR_NAMES.RED],
		Colors[COLOR_NAMES.PINK],
		Colors[COLOR_NAMES.ORANGE]
	];

	const demoItems: DemoItem[] = [
		// Input needed - with interactive question
		{
			id: 'auth-module',
			sectionId: 'answer_needed',
			title: 'Implementing auth module',
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
				question: 'Which auth strategy should I use?',
				multiSelect: false,
				options: [{ label: 'JWT tokens' }, { label: 'Session cookies' }, { label: 'OAuth 2.0' }]
			},
			projectName: 'Acme',
			projectColor: TAG_COLORS[1]
		},
		// Working - with tool and progress
		{
			id: 'api-refactor',
			sectionId: 'working',
			title: 'API endpoint refactor',
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
		},
		// Working - with subagents
		{
			id: 'test-suite',
			sectionId: 'working',
			title: 'Test coverage expansion',
			mode: 'build',
			timeAgo: '5m',
			insertions: 156,
			deletions: 12,
			isStreaming: true,
			statusText: null,
			showStatusShimmer: false,
			fileToolDisplayText: null,
			toolContent: null,
			showToolShimmer: false,
			taskSubagentSummaries: ['Analyzing auth.test.ts', 'Writing store tests', 'Running suite'],
			showTaskSubagentList: true,
			todoProgress: null,
			question: null,
			projectName: 'Acme',
			projectColor: TAG_COLORS[1]
		},
		// Planning
		{
			id: 'architecture',
			sectionId: 'planning',
			title: 'Architecture review',
			mode: 'plan',
			timeAgo: '3m',
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
			projectName: 'Monorepo',
			projectColor: TAG_COLORS[5]
		},
		// Finished
		{
			id: 'db-migration',
			sectionId: 'needs_review',
			title: 'Database migration',
			mode: null,
			timeAgo: '12m',
			insertions: 34,
			deletions: 8,
			isStreaming: false,
			statusText: null,
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
		},
		// Error
		{
			id: 'deploy-fail',
			sectionId: 'error',
			title: 'CI pipeline fix',
			mode: null,
			timeAgo: '8m',
			insertions: 0,
			deletions: 0,
			isStreaming: false,
			statusText: 'Build failed: missing env var',
			showStatusShimmer: false,
			fileToolDisplayText: null,
			toolContent: null,
			showToolShimmer: false,
			taskSubagentSummaries: [],
			showTaskSubagentList: false,
			todoProgress: null,
			question: null,
			projectName: 'Acme',
			projectColor: TAG_COLORS[1]
		}
	];

	// =========================================================================
	// SECTION DEFINITIONS
	// =========================================================================

	const SECTION_LABELS: Record<string, string> = {
		answer_needed: 'Input Needed',
		working: 'Working',
		planning: 'Planning',
		needs_review: 'Needs Review',
		error: 'Error'
	};

	const groups = $derived<readonly SectionedFeedGroup<DemoItem>[]>(
		['answer_needed', 'working', 'planning', 'needs_review', 'error']
			.map((id) => ({
				id: id as 'answer_needed' | 'working' | 'planning' | 'needs_review' | 'error',
				label: SECTION_LABELS[id],
				items: demoItems.filter((item) => item.sectionId === id)
			}))
			.filter((g) => g.items.length > 0)
	);

	// =========================================================================
	// INTERACTIVE STATE
	// =========================================================================

	let selectedItemId = $state<string | null>(null);

	// Question interaction state per item
	const questionSelections = $state<Map<string, Set<string>>>(new Map());
	const otherTexts = $state<Map<string, string>>(new Map());
	const submittedItems = $state<Set<string>>(new Set());

	function getQuestionOptions(item: DemoItem): readonly ActivityEntryQuestionOption[] {
		if (!item.question) return [];
		const selected = questionSelections.get(item.id) ?? new Set<string>();
		return item.question.options.map((opt, i) => ({
			label: opt.label,
			selected: selected.has(opt.label),
			color: QUESTION_COLORS[i % QUESTION_COLORS.length]
		}));
	}

	function isAnswered(itemId: string): boolean {
		const selections = questionSelections.get(itemId);
		const otherText = otherTexts.get(itemId);
		return (selections?.size ?? 0) > 0 || (otherText?.trim().length ?? 0) > 0;
	}

	function getAnswerDisplay(itemId: string): string {
		const selections = questionSelections.get(itemId);
		const otherText = otherTexts.get(itemId);
		const answers: string[] = [];
		if (selections) answers.push(...selections);
		if (otherText?.trim()) answers.push(otherText.trim());
		return answers.join(', ');
	}

	function handleOptionSelect(itemId: string, optionLabel: string, multiSelect: boolean) {
		if (submittedItems.has(itemId)) return;

		const current = questionSelections.get(itemId) ?? new Set<string>();
		if (multiSelect) {
			if (current.has(optionLabel)) {
				current.delete(optionLabel);
			} else {
				current.add(optionLabel);
			}
		} else {
			current.clear();
			current.add(optionLabel);
			// Auto-submit for single-select
			submittedItems.add(itemId);
			setTimeout(() => {
				submittedItems.delete(itemId);
				questionSelections.delete(itemId);
				otherTexts.delete(itemId);
			}, 2000);
		}
		questionSelections.set(itemId, current);
	}

	function handleOtherInput(itemId: string, value: string) {
		otherTexts.set(itemId, value);
	}

	function handleOtherKeydown(itemId: string, key: string) {
		if (key === 'Enter') {
			const text = otherTexts.get(itemId)?.trim();
			if (text) {
				submittedItems.add(itemId);
				setTimeout(() => {
					submittedItems.delete(itemId);
					questionSelections.delete(itemId);
					otherTexts.delete(itemId);
				}, 2000);
			}
		}
	}
</script>

<div class="queue-demo">
	{#snippet itemRenderer(rawItem: unknown)}
		{@const item = rawItem as DemoItem}
		{#if submittedItems.has(item.id)}
			<FeedItem selected={false}>
				<div class="queue-demo-submitted">
					<span class="queue-demo-submitted-check">✓</span>
					<span>Answered!</span>
				</div>
			</FeedItem>
		{:else}
			{#snippet projectBadge()}
				<ProjectLetterBadge name={item.projectName} color={item.projectColor} size={16} />
			{/snippet}
			<ActivityEntry
				selected={selectedItemId === item.id}
				onSelect={() => (selectedItemId = item.id)}
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
				currentQuestionAnswered={isAnswered(item.id)}
				currentAnswerDisplay={getAnswerDisplay(item.id)}
				currentQuestionOptions={getQuestionOptions(item)}
				otherText={otherTexts.get(item.id) ?? ''}
				otherPlaceholder="Type custom answer..."
				showSubmitButton={false}
				canSubmit={false}
				submitLabel=""
				onOptionSelect={(label) =>
					handleOptionSelect(item.id, label, item.question?.multiSelect ?? false)}
				onOtherInput={(value) => handleOtherInput(item.id, value)}
				onOtherKeydown={(key) => handleOtherKeydown(item.id, key)}
				onSubmitAll={() => {}}
				onPrevQuestion={() => {}}
				onNextQuestion={() => {}}
			/>
		{/if}
	{/snippet}

	<SectionedFeed
		{groups}
		totalCount={demoItems.length}
		{itemRenderer}
	/>

	<div class="queue-demo-hint">Try clicking options above — it's fully interactive</div>
</div>

<style>
	.queue-demo {
		width: 100%;
		max-width: 420px;
		/* Provide --success for the @acepe/ui components */
		--success: #22c55e;
		--success-foreground: #ffffff;
	}

	.queue-demo-submitted {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.75rem;
		color: var(--success, #22c55e);
		font-size: 0.8125rem;
		font-weight: 500;
		animation: demoFadeIn 0.3s ease-out;
	}

	.queue-demo-submitted-check {
		font-size: 1rem;
	}

	.queue-demo-hint {
		margin-top: 0.75rem;
		text-align: center;
		font-size: 0.75rem;
		color: var(--muted-foreground);
		opacity: 0.7;
		font-style: italic;
	}

	@keyframes demoFadeIn {
		from {
			opacity: 0;
			transform: scale(0.95);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}
</style>
