<script lang="ts">
	import type { WorkerPoolManager } from "@pierre/diffs/worker";
	import type {
		AgentPanelConversationEntry as AgentPanelConversationEntryModel,
	} from "../agent-panel/types.js";

	import AgentAssistantMessage from "../agent-panel/agent-assistant-message.svelte";
	import AgentToolEdit from "../agent-panel/agent-tool-edit.svelte";
	import AgentToolExecute from "../agent-panel/agent-tool-execute.svelte";
	import AgentToolFetch from "../agent-panel/agent-tool-fetch.svelte";
	import AgentToolOther from "../agent-panel/agent-tool-other.svelte";
	import AgentToolQuestion from "../agent-panel/agent-tool-question.svelte";
	import AgentToolRead from "../agent-panel/agent-tool-read.svelte";
	import AgentToolReadLints from "../agent-panel/agent-tool-read-lints.svelte";
	import AgentToolRow from "../agent-panel/agent-tool-row.svelte";
	import AgentToolSearch from "../agent-panel/agent-tool-search.svelte";
	import AgentToolSkill from "../agent-panel/agent-tool-skill.svelte";
	import AgentToolTask from "../agent-panel/agent-tool-task.svelte";
	import AgentToolTodo from "../agent-panel/agent-tool-todo.svelte";
	import AgentToolWebSearch from "../agent-panel/agent-tool-web-search.svelte";
	import AgentUserMessage from "../agent-panel/agent-user-message.svelte";
	import AgentMissingSceneEntry from "../agent-panel/agent-missing-scene-entry.svelte";
	import AgentThinkingSceneEntry from "../agent-panel/agent-thinking-scene-entry.svelte";
	import type { EditToolTheme } from "../agent-panel/agent-tool-edit-theme.js";

	interface Props {
		entry: AgentPanelConversationEntryModel;
		iconBasePath?: string;
		editToolTheme?: EditToolTheme;
	}

	let { entry, iconBasePath = "/svgs/icons", editToolTheme }: Props = $props();

	function isToolCall(
		value: AgentPanelConversationEntryModel
	): value is Extract<AgentPanelConversationEntryModel, { type: "tool_call" }> {
		return value.type === "tool_call";
	}

	const lintFileCount = $derived.by(() => {
		if (!isToolCall(entry) || !entry.lintDiagnostics || entry.lintDiagnostics.length === 0) {
			return 0;
		}

		return new Set(entry.lintDiagnostics.map((diagnostic) => diagnostic.filePath ?? "unknown")).size;
	});

	const questionOptions = $derived.by(() => {
		if (!isToolCall(entry) || !entry.question?.options) {
			return null;
		}

		return entry.question.options.map((option) => {
			return {
				label: option.label,
				description: option.description
			};
		});
	});
</script>

{#if entry.type === "user"}
	<AgentUserMessage text={entry.text} chunks={entry.chunks} timestampMs={entry.timestampMs} />
{:else if entry.type === "assistant"}
	<AgentAssistantMessage
		messageId={entry.id}
		message={entry.message ?? {
			chunks: [{ type: "message", block: { type: "text", text: entry.markdown } }],
		}}
		isStreaming={entry.isStreaming}
		timestampMs={entry.timestampMs}
		{iconBasePath}
	/>
{:else if entry.type === "thinking"}
	<AgentThinkingSceneEntry
		durationMs={entry.durationMs}
		startedAtMs={entry.startedAtMs}
		label={entry.label}
		agentIconSrc={entry.agentIconSrc}
		showWorkingSpark={entry.showWorkingSpark ?? false}
	/>
{:else if entry.type === "missing"}
	<AgentMissingSceneEntry
		title={entry.title}
		message={entry.message}
		diagnosticLabel={entry.diagnosticLabel}
	/>
{:else if isToolCall(entry) && entry.todos && entry.todos.length > 0}
	<AgentToolTodo
		todos={entry.todos.map((todo) => ({
			content: todo.content,
			activeForm: todo.activeForm,
			status: todo.status,
			duration: todo.duration
		}))}
		isLive={entry.status === "running"}
	/>
{:else if isToolCall(entry) && entry.question}
	<AgentToolQuestion
		questions={[
			{
				question: entry.question.question,
				header: entry.question.header,
				options: questionOptions,
				multiSelect: entry.question.multiSelect
			}
		]}
		status={entry.status}
		isInteractive={entry.status === "running"}
	/>
{:else if isToolCall(entry) && entry.lintDiagnostics !== undefined}
	<AgentToolReadLints
		status={entry.status}
		totalDiagnostics={entry.lintDiagnostics.length}
		totalFiles={lintFileCount}
		diagnostics={entry.lintDiagnostics.map((diagnostic) => ({
			filePath: diagnostic.filePath,
			line: diagnostic.line,
			message: diagnostic.message,
			severity: diagnostic.severity
		}))}
		summaryLabel={`${entry.lintDiagnostics.length} issues in ${lintFileCount} files`}
	/>
{:else if isToolCall(entry) && entry.kind === "read"}
	<AgentToolRead
		toolCallId={entry.toolCallId ?? entry.id}
		filePath={entry.filePath}
		sourceExcerpt={entry.sourceExcerpt ?? null}
		sourceExcerptHtml={entry.sourceExcerptHtml ?? null}
		highlightSource={entry.highlightSource ?? null}
		sourceRangeLabel={entry.sourceRangeLabel ?? null}
		status={entry.status}
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
		iconBasePath={iconBasePath}
		theme={editToolTheme?.theme}
		themeNames={editToolTheme?.themeNames}
		workerPool={editToolTheme?.workerPool}
		onBeforeRender={editToolTheme?.onBeforeRender}
		unsafeCSS={editToolTheme?.unsafeCSS}
	/>
{:else if isToolCall(entry) && entry.kind === "execute"}
	<AgentToolExecute
		command={entry.command ?? null}
		commandHtmls={entry.commandHtmls}
		highlightCommand={entry.highlightCommand ?? null}
		highlightOutput={entry.highlightOutput ?? null}
		stdout={entry.stdout}
		stderr={entry.stderr}
		stdoutHtml={entry.stdoutHtml}
		stderrHtml={entry.stderrHtml}
		exitCode={entry.exitCode}
		status={entry.status}
	/>
{:else if isToolCall(entry) && entry.kind === "search"}
	<AgentToolSearch
		query={entry.query ?? null}
		searchPath={entry.searchPath}
		files={entry.searchFiles ? Array.from(entry.searchFiles) : undefined}
		resultCount={entry.searchResultCount}
		status={entry.status}
		{iconBasePath}
	/>
{:else if isToolCall(entry) && entry.kind === "fetch"}
	<AgentToolFetch
		url={entry.url ?? null}
		domain={entry.subtitle ?? null}
		resultText={entry.resultText ?? null}
		status={entry.status}
	/>
{:else if isToolCall(entry) && entry.kind === "web_search"}
	<AgentToolWebSearch
		query={entry.query ?? entry.subtitle ?? null}
		links={entry.webSearchLinks ? Array.from(entry.webSearchLinks) : []}
		summary={entry.webSearchSummary ?? null}
		status={entry.status}
	/>
{:else if isToolCall(entry) && entry.kind === "skill"}
	<AgentToolSkill
		skillName={entry.skillName}
		skillArgs={entry.skillArgs}
		description={entry.skillDescription}
		status={entry.status}
	/>
{:else if isToolCall(entry) && (entry.kind === "task" || entry.kind === "task_output")}
	<AgentToolTask
		description={entry.taskDescription ?? entry.title}
		prompt={entry.taskPrompt}
		latestAction={entry.taskLatestAction}
		status={entry.status}
		{iconBasePath}
	/>
{:else if isToolCall(entry) && entry.status === "error" && entry.resultText}
	<div class="rounded border border-destructive/30 bg-destructive/5 px-3 py-2">
		<p class="text-sm font-medium text-destructive">{entry.title}</p>
		{#if entry.subtitle}
			<p class="mt-1 text-sm text-muted-foreground">{entry.subtitle}</p>
		{/if}
		<p class="mt-2 whitespace-pre-wrap text-sm text-foreground">{entry.resultText}</p>
	</div>
{:else if isToolCall(entry)}
	<AgentToolOther
		title={entry.title}
		subtitle={entry.subtitle}
		detailsText={entry.detailsText ?? null}
		status={entry.status}
	/>
{/if}
