<script lang="ts">
	import type {
		AgentPanelPlanActionEvent,
		AgentPanelPlanViewEvent,
		AgentPanelQuestionSelectEvent,
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
	import AgentPanelToolEdit from "./agent-panel-tool-edit.svelte";
	import { toolDurationClock } from "./tool-duration-clock.js";
	import { formatToolDurationLabel } from "./tool-duration.js";

	interface Props {
		entry: AgentToolEntry;
		iconBasePath?: string;
		editToolTheme?: EditToolTheme;
		onQuestionSelect?: (event: AgentPanelQuestionSelectEvent) => void;
		onPlanBuild?: (event: AgentPanelPlanActionEvent) => void;
		onPlanCancel?: (event: AgentPanelPlanActionEvent) => void;
		onPlanViewFull?: (event: AgentPanelPlanViewEvent) => void;
		onToolFileSelect?: (event: AgentToolFileSelectEvent) => void;
		isPlanActionAvailable?: (event: AgentPanelPlanActionEvent) => boolean;
	}

	let {
		entry,
		iconBasePath = "",
		editToolTheme,
		onQuestionSelect,
		onPlanBuild,
		onPlanCancel,
		onPlanViewFull,
		onToolFileSelect,
		isPlanActionAvailable,
	}: Props = $props();

	const renderKind = $derived(resolveConversationRenderKind(entry));
	const toolDurationLabel = $derived(
		formatToolDurationLabel({
			startedAtMs: entry.startedAtMs,
			completedAtMs: entry.completedAtMs,
			status: entry.status,
			nowMs: $toolDurationClock,
		})
	);
</script>

{#if renderKind === "tool-todo"}
	<AgentToolTodo
		todos={entry.todos ?? []}
		isLive={entry.status === "running"}
		durationLabel={toolDurationLabel ?? undefined}
	/>
{:else if renderKind === "tool-question"}
	<AgentPanelToolQuestion
		{entry}
		durationLabel={toolDurationLabel ?? undefined}
		{onQuestionSelect}
	/>
{:else if renderKind === "tool-read-lints"}
	<AgentPanelToolRead
		{entry}
		variant="read-lints"
		durationLabel={toolDurationLabel ?? undefined}
	/>
{:else if renderKind === "tool-read"}
	<AgentPanelToolRead
		{entry}
		variant="read"
		durationLabel={toolDurationLabel ?? undefined}
		{iconBasePath}
		{onToolFileSelect}
	/>
{:else if renderKind === "tool-edit"}
	<AgentPanelToolEdit
		{entry}
		{iconBasePath}
		{editToolTheme}
		durationLabel={toolDurationLabel ?? undefined}
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
		durationLabel={toolDurationLabel ?? undefined}
		{iconBasePath}
	/>
{/if}
