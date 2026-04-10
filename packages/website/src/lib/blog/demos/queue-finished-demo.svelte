<script lang="ts">
/**
 * Demo: Finished State
 * Shows a completed task with final stats.
 */
import { SectionedFeed, ActivityEntry, TAG_COLORS } from "@acepe/ui";
import type { SectionedFeedGroup, ActivityEntryTodoProgress } from "@acepe/ui";

interface DemoItem {
	readonly id: string;
	readonly title: string;
	readonly mode: "build" | "plan" | null;
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
	readonly question: null;
	readonly projectName: string;
	readonly projectColor: string;
}

const demoItem: DemoItem = {
	id: "finished-demo",
	title: "Database migration",
	mode: null,
	timeAgo: "12m",
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
	todoProgress: { current: 4, total: 4, label: "Complete" },
	question: null,
	projectName: "Backend",
	projectColor: TAG_COLORS[3],
};

const groups: readonly SectionedFeedGroup<DemoItem>[] = [
	{
		id: "needs_review",
		label: "Needs Review",
		items: [demoItem],
	},
];

let selectedItemId = $state<string | null>(null);
</script>

<div class="demo-container">
	<p class="demo-hint">
		Finished tasks show final stats: insertions, deletions, and completion status.
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
				currentQuestion={null}
				totalQuestions={0}
				hasMultipleQuestions={false}
				currentQuestionIndex={0}
				questionId={''}
				questionProgress={[]}
				currentQuestionAnswered={false}
				currentAnswerDisplay={''}
				currentQuestionOptions={[]}
				otherText={''}
				otherPlaceholder={''}
				showSubmitButton={false}
				canSubmit={false}
				submitLabel={''}
				onOptionSelect={() => {}}
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
