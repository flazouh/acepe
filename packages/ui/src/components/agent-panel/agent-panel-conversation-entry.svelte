<script lang="ts">
	import type { AgentPanelConversationEntry } from "./types.js";

	import AgentAssistantMessage from "./agent-assistant-message.svelte";
	import AgentToolExecute from "./agent-tool-execute.svelte";
	import AgentToolFetch from "./agent-tool-fetch.svelte";
	import AgentToolQuestion from "./agent-tool-question.svelte";
	import AgentToolRead from "./agent-tool-read.svelte";
	import AgentToolReadLints from "./agent-tool-read-lints.svelte";
	import AgentToolOther from "./agent-tool-other.svelte";
	import AgentToolBrowser from "./agent-tool-browser.svelte";
	import AgentToolRow from "./agent-tool-row.svelte";
	import AgentToolSearch from "./agent-tool-search.svelte";
	import AgentToolTask from "./agent-tool-task.svelte";
	import AgentToolTodo from "./agent-tool-todo.svelte";
	import AgentToolWebSearch from "./agent-tool-web-search.svelte";
	import AgentUserMessage from "./agent-user-message.svelte";
	import { TextShimmer } from "../text-shimmer/index.js";

	interface Props {
		entry: AgentPanelConversationEntry;
		iconBasePath?: string;
	}

	let { entry, iconBasePath = "" }: Props = $props();

	function isToolCall(
		value: AgentPanelConversationEntry,
	): value is Extract<AgentPanelConversationEntry, { type: "tool_call" }> {
		return value.type === "tool_call";
	}

	const lintFileCount = $derived.by(() => {
		if (!isToolCall(entry) || !entry.lintDiagnostics || entry.lintDiagnostics.length === 0) {
			return 0;
		}

		return new Set(entry.lintDiagnostics.map((diagnostic) => diagnostic.filePath ?? "unknown")).size;
	});
 </script>

{#if entry.type === "user"}
	<AgentUserMessage text={entry.text} />
{:else if entry.type === "assistant"}
	<AgentAssistantMessage markdown={entry.markdown} isStreaming={entry.isStreaming} {iconBasePath} />
{:else if entry.type === "thinking"}
	<div class="py-2 text-sm text-muted-foreground">
		<TextShimmer>Planning next moves…</TextShimmer>
	</div>
{:else if isToolCall(entry) && entry.todos && entry.todos.length > 0}
	<AgentToolTodo todos={entry.todos} isLive={entry.status === "running"} />
{:else if isToolCall(entry) && entry.question}
	<AgentToolQuestion
		questions={[entry.question]}
		status={entry.status}
		isInteractive={entry.status === "running"}
	/>
{:else if isToolCall(entry) && entry.lintDiagnostics !== undefined}
	<AgentToolReadLints
		status={entry.status}
		totalDiagnostics={entry.lintDiagnostics.length}
		totalFiles={lintFileCount}
		diagnostics={entry.lintDiagnostics}
		summaryLabel={`${entry.lintDiagnostics.length} issues in ${lintFileCount} files`}
	/>
{:else if isToolCall(entry) && entry.kind === "read"}
	<AgentToolRead filePath={entry.filePath} status={entry.status} {iconBasePath} />
{:else if isToolCall(entry) && entry.kind === "execute"}
	<AgentToolExecute
		command={entry.command ?? null}
		stdout={entry.stdout}
		stderr={entry.stderr}
		exitCode={entry.exitCode}
		status={entry.status}
	/>
{:else if isToolCall(entry) && entry.kind === "search"}
	<AgentToolSearch
		query={entry.query ?? null}
		searchPath={entry.searchPath}
		files={entry.searchFiles}
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
		links={entry.webSearchLinks ?? []}
		summary={entry.webSearchSummary ?? null}
		status={entry.status}
	/>
{:else if isToolCall(entry) && entry.kind === "other"}
	<AgentToolOther
		title={entry.title}
		subtitle={entry.subtitle ?? null}
		detailsText={entry.detailsText ?? null}
		status={entry.status}
	/>
{:else if isToolCall(entry) && entry.kind === "browser"}
	<AgentToolBrowser
		title={entry.title}
		subtitle={entry.subtitle ?? null}
		detailsText={entry.detailsText ?? null}
		status={entry.status}
	/>
{:else if isToolCall(entry) && (entry.kind === "task" || entry.kind === "task_output")}
	<AgentToolTask
		description={entry.taskDescription ?? entry.title}
		prompt={entry.taskPrompt}
		resultText={entry.taskResultText}
		children={entry.taskChildren}
		status={entry.status}
		{iconBasePath}
	/>
{:else if isToolCall(entry) && entry.status === "error" && entry.resultText}
	<div class="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
		<p class="text-sm font-medium text-destructive">{entry.title}</p>
		{#if entry.subtitle}
			<p class="mt-1 text-[11px] text-muted-foreground">{entry.subtitle}</p>
		{/if}
		<p class="mt-2 whitespace-pre-wrap text-xs text-foreground">{entry.resultText}</p>
	</div>
{:else if isToolCall(entry)}
	<AgentToolRow
		title={entry.title}
		subtitle={entry.subtitle}
		filePath={entry.filePath}
		status={entry.status}
		kind={entry.kind}
		{iconBasePath}
	/>
{/if}
