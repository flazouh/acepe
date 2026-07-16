<script lang="ts">
import type {
	AgentPanelPlanActionEvent,
	AgentPanelPlanViewEvent,
	AgentPanelQuestionSelectEvent,
	AgentPanelReviewActionEvent,
	AgentToolFileSelectEvent,
} from "./types.js";
import {
	resolveConversationRenderKind,
	type AgentToolEntry,
} from "./agent-panel-conversation-entry-model.js";
import type { EditToolTheme } from "./agent-tool-edit-theme.js";

import AgentToolTodo from "./agent-tool-todo.svelte";
import AgentPanelStandardToolEntry from "./agent-panel-standard-tool-entry.svelte";
import AgentPanelToolPlan from "./agent-panel-tool-plan.svelte";
import AgentPanelToolQuestion from "./agent-panel-tool-question.svelte";
import AgentPanelToolRead from "./agent-panel-tool-read.svelte";
import AgentPanelToolReview from "./agent-panel-tool-review.svelte";
import AgentPanelToolEdit from "./agent-panel-tool-edit.svelte";
import type { ToolDurationTiming } from "./tool-duration.js";

interface Props {
	entry: AgentToolEntry;
	iconBasePath?: string;
	editToolTheme?: EditToolTheme;
	onQuestionSelect?: (event: AgentPanelQuestionSelectEvent) => void;
	onPlanBuild?: (event: AgentPanelPlanActionEvent) => void;
	onPlanCancel?: (event: AgentPanelPlanActionEvent) => void;
	onPlanViewFull?: (event: AgentPanelPlanViewEvent) => void;
	onToolFileSelect?: (event: AgentToolFileSelectEvent) => void;
	onReview?: (event: AgentPanelReviewActionEvent) => void;
	isPlanActionAvailable?: (event: AgentPanelPlanActionEvent) => boolean;
}

let {
	entry,
	iconBasePath = "/svgs/icons",
	editToolTheme,
	onQuestionSelect,
	onPlanBuild,
	onPlanCancel,
	onPlanViewFull,
	onToolFileSelect,
	onReview,
	isPlanActionAvailable,
}: Props = $props();

const renderKind = $derived(resolveConversationRenderKind(entry));
const durationTiming = $derived<ToolDurationTiming>({
	startedAtMs: entry.startedAtMs,
	completedAtMs: entry.completedAtMs,
	status: entry.status,
});
</script>

{#if renderKind === "tool-todo"}
	<AgentToolTodo
		todos={entry.todos ?? []}
		isLive={entry.status === "running"}
	/>
{:else if renderKind === "tool-question"}
	<AgentPanelToolQuestion
		{entry}
		{durationTiming}
		{onQuestionSelect}
	/>
{:else if renderKind === "tool-read-lints"}
	<AgentPanelToolRead
		{entry}
		variant="read-lints"
		{durationTiming}
	/>
{:else if renderKind === "tool-read"}
	<AgentPanelToolRead
		{entry}
		variant="read"
		{durationTiming}
		{iconBasePath}
		{onToolFileSelect}
	/>
{:else if renderKind === "tool-edit"}
	<AgentPanelToolEdit
		{entry}
		{iconBasePath}
		{editToolTheme}
		{durationTiming}
	/>
{:else if renderKind === "tool-review"}
	<AgentPanelToolReview
		{entry}
		{durationTiming}
		{iconBasePath}
		{onReview}
	/>
{:else if renderKind === "tool-plan"}
	<AgentPanelToolPlan
		{entry}
		onBuild={onPlanBuild}
		onCancel={onPlanCancel}
		onViewFull={onPlanViewFull}
		isActionAvailable={isPlanActionAvailable}
	/>
{:else}
	<AgentPanelStandardToolEntry
		{entry}
		{renderKind}
		{durationTiming}
		{iconBasePath}
	/>
{/if}
