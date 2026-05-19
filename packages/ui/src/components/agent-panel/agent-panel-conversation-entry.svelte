<script lang="ts">
	import type { WorkerPoolManager } from "@pierre/diffs/worker";
	import type { Snippet } from "svelte";
	import type {
		AgentPanelConversationEntry,
		AgentPanelPlanActionEvent,
		AgentPanelPlanViewEvent,
		AgentPanelQuestionSelectEvent,
		AssistantRenderBlockContext,
	} from "./types.js";
	import type { StreamingAnimationMode } from "../../lib/assistant-message/types.js";

	import AgentAssistantMessage from "./agent-assistant-message.svelte";
	import AgentToolExecute from "./agent-tool-execute.svelte";
	import AgentToolFetch from "./agent-tool-fetch.svelte";
	import AgentToolQuestion from "./agent-tool-question.svelte";
	import AgentToolRead from "./agent-tool-read.svelte";
	import AgentToolReadLints from "./agent-tool-read-lints.svelte";
	import AgentToolOther from "./agent-tool-other.svelte";
	import AgentToolBrowser from "./agent-tool-browser.svelte";
	import AgentToolEdit from "./agent-tool-edit.svelte";
	import AgentToolRow from "./agent-tool-row.svelte";
	import AgentToolSearch from "./agent-tool-search.svelte";
	import AgentToolSkill from "./agent-tool-skill.svelte";
	import AgentToolTask from "./agent-tool-task.svelte";
	import AgentToolTodo from "./agent-tool-todo.svelte";
	import AgentToolWebSearch from "./agent-tool-web-search.svelte";
	import AgentThinkingSceneEntry from "./agent-thinking-scene-entry.svelte";
	import AgentUserMessage from "./agent-user-message.svelte";
	import AgentMissingSceneEntry from "./agent-missing-scene-entry.svelte";
	import { toolDurationClock } from "./tool-duration-clock.js";
	import { formatToolDurationLabel } from "./tool-duration.js";
	import { PlanCard } from "../plan-card/index.js";
	import type { PlanCardStatus } from "../plan-card/types.js";

	export interface EditToolTheme {
		theme?: "light" | "dark";
		themeNames?: { dark: string; light: string };
		workerPool?: WorkerPoolManager;
		onBeforeRender?: () => Promise<void>;
		unsafeCSS?: string;
	}

	interface Props {
		entry: AgentPanelConversationEntry;
		iconBasePath?: string;
		editToolTheme?: EditToolTheme;
		projectPath?: string;
		streamingAnimationMode?: StreamingAnimationMode;
		renderAssistantBlock?: Snippet<[AssistantRenderBlockContext]>;
		onQuestionSelect?: (event: AgentPanelQuestionSelectEvent) => void;
		onPlanBuild?: (event: AgentPanelPlanActionEvent) => void;
		onPlanCancel?: (event: AgentPanelPlanActionEvent) => void;
		onPlanViewFull?: (event: AgentPanelPlanViewEvent) => void;
		isPlanActionAvailable?: (event: AgentPanelPlanActionEvent) => boolean;
	}

	let {
		entry,
		iconBasePath = "",
		editToolTheme,
		projectPath,
		streamingAnimationMode = "smooth",
		renderAssistantBlock,
		onQuestionSelect,
		onPlanBuild,
		onPlanCancel,
		onPlanViewFull,
		isPlanActionAvailable,
	}: Props = $props();

	let questionOtherTextByEntry = $state<Record<string, Record<number, string>>>({});

	function isToolCall(
		value: AgentPanelConversationEntry,
	): value is Extract<AgentPanelConversationEntry, { type: "tool_call" }> {
		return value.type === "tool_call";
	}

	const toolDurationLabel = $derived.by(() => {
		if (!isToolCall(entry)) {
			return null;
		}

		return formatToolDurationLabel({
			startedAtMs: entry.startedAtMs,
			completedAtMs: entry.completedAtMs,
			status: entry.status,
			nowMs: $toolDurationClock,
		});
	});

	function questionOtherText(
		toolEntry: Extract<AgentPanelConversationEntry, { type: "tool_call" }>,
	): Record<number, string> {
		return questionOtherTextByEntry[toolEntry.id] ?? {};
	}

	function handleQuestionOtherInput(
		toolEntry: Extract<AgentPanelConversationEntry, { type: "tool_call" }>,
		questionIndex: number,
		text: string,
	): void {
		if (questionOtherTextByEntry[toolEntry.id] === undefined) {
			questionOtherTextByEntry[toolEntry.id] = {};
		}

		questionOtherTextByEntry[toolEntry.id][questionIndex] = text;
	}

	function handleQuestionOtherKeydown(
		toolEntry: Extract<AgentPanelConversationEntry, { type: "tool_call" }>,
		questionIndex: number,
		key: string,
		multiSelect?: boolean,
	): void {
		if (key !== "Enter") {
			return;
		}

		const label = questionOtherTextByEntry[toolEntry.id]?.[questionIndex]?.trim() ?? "";
		if (label.length === 0) {
			return;
		}

		onQuestionSelect?.({
			entryId: toolEntry.id,
			interactionId: toolEntry.interactionId,
			questionIndex,
			label,
			multiSelect,
		});
	}

	const lintFileCount = $derived.by(() => {
		if (!isToolCall(entry) || !entry.lintDiagnostics || entry.lintDiagnostics.length === 0) {
			return 0;
		}

		return new Set(entry.lintDiagnostics.map((diagnostic) => diagnostic.filePath ?? "unknown")).size;
	});

	function resolvePlanStatus(
		status: Extract<AgentPanelConversationEntry, { type: "tool_call" }>["status"],
		planStatus: PlanCardStatus | undefined,
	): PlanCardStatus {
		if (planStatus !== undefined) {
			return planStatus;
		}
		if (status === "error" || status === "cancelled") {
			return "rejected";
		}
		if (status === "done") {
			return "approved";
		}
		return "streaming";
	}

	function planActionEvent(
		toolEntry: Extract<AgentPanelConversationEntry, { type: "tool_call" }>,
	): AgentPanelPlanActionEvent {
		return {
			entryId: toolEntry.id,
			toolCallId: toolEntry.toolCallId,
			interactionId: toolEntry.interactionId,
		};
	}

	function planViewEvent(
		toolEntry: Extract<AgentPanelConversationEntry, { type: "tool_call" }>,
	): AgentPanelPlanViewEvent {
		return {
			entryId: toolEntry.id,
			toolCallId: toolEntry.toolCallId,
			interactionId: toolEntry.interactionId,
			title: toolEntry.planTitle ?? toolEntry.title,
			content: toolEntry.planContent ?? "",
		};
	}

	function planActionsDisabled(
		toolEntry: Extract<AgentPanelConversationEntry, { type: "tool_call" }>,
	): boolean {
		if (!isPlanActionAvailable) {
			return false;
		}
		return !isPlanActionAvailable(planActionEvent(toolEntry));
	}
 </script>

{#if entry.type === "user"}
	<AgentUserMessage text={entry.text} timestampMs={entry.timestampMs} />
{:else if entry.type === "assistant"}
		<AgentAssistantMessage
			message={entry.message ?? {
				chunks: [{ type: "message", block: { type: "text", text: entry.markdown } }],
			}}
			isStreaming={entry.isStreaming}
			tokenRevealCss={entry.tokenRevealCss}
			timestampMs={entry.timestampMs}
			{projectPath}
			{streamingAnimationMode}
		{iconBasePath}
		renderBlock={renderAssistantBlock}
	/>
{:else if entry.type === "thinking"}
	<AgentThinkingSceneEntry
		durationMs={entry.durationMs}
		startedAtMs={entry.startedAtMs}
		label={entry.label}
	/>
{:else if entry.type === "missing"}
	<AgentMissingSceneEntry
		title={entry.title}
		message={entry.message}
		diagnosticLabel={entry.diagnosticLabel}
	/>
{:else if isToolCall(entry) && entry.todos && entry.todos.length > 0}
	<AgentToolTodo
		todos={entry.todos}
		isLive={entry.status === "running"}
		durationLabel={toolDurationLabel ?? undefined}
	/>
{:else if isToolCall(entry) && entry.question}
	<AgentToolQuestion
		questions={[entry.question]}
		status={entry.status}
		isInteractive={entry.status === "running"}
		otherText={questionOtherText(entry)}
		durationLabel={toolDurationLabel ?? undefined}
		onSelect={(questionIndex, label, multiSelect) =>
			onQuestionSelect?.({
				entryId: entry.id,
				interactionId: entry.interactionId,
				questionIndex,
				label,
				multiSelect,
			})}
		onOtherInput={(questionIndex, text) =>
			handleQuestionOtherInput(entry, questionIndex, text)}
		onOtherKeydown={(questionIndex, key, multiSelect) =>
			handleQuestionOtherKeydown(entry, questionIndex, key, multiSelect)}
	/>
{:else if isToolCall(entry) && (entry.kind === "read_lints" || entry.lintDiagnostics !== undefined)}
	<AgentToolReadLints
		status={entry.status}
		totalDiagnostics={entry.lintDiagnostics?.length ?? 0}
		totalFiles={lintFileCount}
		diagnostics={entry.lintDiagnostics ?? null}
		summaryLabel={`${entry.lintDiagnostics?.length ?? 0} issues in ${lintFileCount} files`}
		durationLabel={toolDurationLabel ?? undefined}
	/>
{:else if isToolCall(entry) && entry.kind === "read"}
	<AgentToolRead
		filePath={entry.filePath}
		sourceExcerpt={entry.sourceExcerpt ?? null}
		sourceRangeLabel={entry.sourceRangeLabel ?? null}
		status={entry.status}
		durationLabel={toolDurationLabel ?? undefined}
		{iconBasePath}
	/>
{:else if isToolCall(entry) && entry.kind === "edit"}
	<AgentToolEdit
		diffs={entry.editDiffs ? Array.from(entry.editDiffs) : []}
		filePath={entry.filePath ?? null}
		isStreaming={entry.status === "pending" || entry.status === "running"}
		status={entry.status}
		applied={entry.status === "done"}
		awaitingApproval={entry.presentationState === "pending_operation"}
		defaultExpanded={true}
		iconBasePath={iconBasePath}
		theme={editToolTheme?.theme}
		themeNames={editToolTheme?.themeNames}
		workerPool={editToolTheme?.workerPool}
		onBeforeRender={editToolTheme?.onBeforeRender}
		unsafeCSS={editToolTheme?.unsafeCSS}
		durationLabel={toolDurationLabel ?? undefined}
	/>
{:else if isToolCall(entry) && entry.kind === "execute"}
	<AgentToolExecute
		command={entry.command ?? null}
		commandHtmls={entry.commandHtmls}
		stdout={entry.stdout}
		stderr={entry.stderr}
		exitCode={entry.exitCode}
		status={entry.status}
		durationLabel={toolDurationLabel ?? undefined}
	/>
{:else if isToolCall(entry) && entry.kind === "search"}
	<AgentToolSearch
		query={entry.query ?? null}
		searchPath={entry.searchPath}
		files={entry.searchFiles}
		resultCount={entry.searchResultCount}
		searchMode={entry.searchMode}
		searchNumFiles={entry.searchNumFiles}
		searchNumMatches={entry.searchNumMatches}
		searchMatches={entry.searchMatches}
		status={entry.status}
		durationLabel={toolDurationLabel ?? undefined}
		{iconBasePath}
	/>
{:else if isToolCall(entry) && entry.kind === "fetch"}
	<AgentToolFetch
		url={entry.url ?? null}
		domain={entry.subtitle ?? null}
		resultText={entry.resultText ?? null}
		status={entry.status}
		durationLabel={toolDurationLabel ?? undefined}
	/>
{:else if isToolCall(entry) && entry.kind === "web_search"}
	<AgentToolWebSearch
		query={entry.query ?? entry.subtitle ?? null}
		links={entry.webSearchLinks ?? []}
		summary={entry.webSearchSummary ?? null}
		status={entry.status}
		durationLabel={toolDurationLabel ?? undefined}
	/>
{:else if isToolCall(entry) && entry.kind === "other"}
	<AgentToolOther
		title={entry.title}
		subtitle={entry.subtitle ?? null}
		detailsText={entry.detailsText ?? null}
		status={entry.status}
		durationLabel={toolDurationLabel ?? undefined}
	/>
{:else if isToolCall(entry) && entry.kind === "browser"}
	<AgentToolBrowser
		title={entry.title}
		subtitle={entry.subtitle ?? null}
		detailsText={entry.detailsText ?? null}
		status={entry.status}
		durationLabel={toolDurationLabel ?? undefined}
	/>
{:else if isToolCall(entry) && entry.kind === "skill"}
	<AgentToolSkill
		skillName={entry.skillName}
		skillArgs={entry.skillArgs}
		description={entry.skillDescription}
		status={entry.status}
		durationLabel={toolDurationLabel ?? undefined}
	/>
{:else if isToolCall(entry) && (entry.kind === "task" || entry.kind === "task_output")}
	<AgentToolTask
		description={entry.taskDescription ?? entry.title}
		prompt={entry.taskPrompt}
		resultText={entry.taskResultText}
		children={entry.taskChildren}
		status={entry.status}
		durationLabel={toolDurationLabel ?? undefined}
		{iconBasePath}
	/>
{:else if isToolCall(entry) && (entry.kind === "exit_plan_mode" || entry.kind === "create_plan")}
	<PlanCard
		content={entry.planContent ?? ""}
		title={entry.planTitle ?? entry.title}
		status={resolvePlanStatus(entry.status, entry.planStatus)}
		onBuild={onPlanBuild ? () => onPlanBuild(planActionEvent(entry)) : undefined}
		onCancel={onPlanCancel ? () => onPlanCancel(planActionEvent(entry)) : undefined}
		onViewFull={onPlanViewFull ? () => onPlanViewFull(planViewEvent(entry)) : undefined}
		actionsDisabled={planActionsDisabled(entry)}
	/>
{:else if isToolCall(entry) && entry.status === "error" && entry.resultText}
	<div class="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
		<p class="text-sm font-medium text-destructive">{entry.title}</p>
		{#if entry.subtitle}
			<p class="mt-1 text-sm text-muted-foreground">{entry.subtitle}</p>
		{/if}
		<p class="mt-2 whitespace-pre-wrap text-sm text-foreground">{entry.resultText}</p>
	</div>
{:else if isToolCall(entry)}
	<AgentToolRow
		title={entry.title}
		subtitle={entry.subtitle}
		filePath={entry.filePath}
		status={entry.status}
		kind={entry.kind}
		durationLabel={toolDurationLabel ?? undefined}
		padded={true}
		{iconBasePath}
	/>
{/if}
