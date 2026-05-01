<script lang="ts">
	import type { WorkerPoolManager } from "@pierre/diffs/worker";
	import type { Snippet } from "svelte";
	import type { AgentPanelConversationEntry } from "./types.js";
	import type { ChunkGroup } from "../../lib/assistant-message/assistant-chunk-grouper.js";
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
	import AgentUserMessage from "./agent-user-message.svelte";
	import AgentMissingSceneEntry from "./agent-missing-scene-entry.svelte";
	import { getPlanningPlaceholderLabel } from "./planning-label.js";

	export interface EditToolTheme {
		theme?: "light" | "dark";
		themeNames?: { dark: string; light: string };
		workerPool?: WorkerPoolManager;
		onBeforeRender?: () => Promise<void>;
		unsafeCSS?: string;
	}

	export interface AssistantRenderBlockContext {
		group: ChunkGroup;
		isStreaming?: boolean;
		revealKey?: string;
		projectPath?: string;
		streamingAnimationMode?: StreamingAnimationMode;
		onRevealActivityChange?: (active: boolean) => void;
	}

	interface Props {
		entry: AgentPanelConversationEntry;
		iconBasePath?: string;
		editToolTheme?: EditToolTheme;
		projectPath?: string;
		streamingAnimationMode?: StreamingAnimationMode;
		renderAssistantBlock?: Snippet<[AssistantRenderBlockContext]>;
	}

	let {
		entry,
		iconBasePath = "",
		editToolTheme,
		projectPath,
		streamingAnimationMode = "smooth",
		renderAssistantBlock,
	}: Props = $props();

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
	<AgentAssistantMessage
		message={entry.message ?? {
			chunks: [{ type: "message", block: { type: "text", text: entry.markdown } }],
		}}
		isStreaming={entry.isStreaming}
		revealMessageKey={entry.revealMessageKey}
		{projectPath}
		{streamingAnimationMode}
		{iconBasePath}
		renderBlock={renderAssistantBlock}
	/>
{:else if entry.type === "thinking"}
	<AgentToolRow title={getPlanningPlaceholderLabel(entry.durationMs)} status="running" padded={false} />
{:else if entry.type === "missing"}
	<AgentMissingSceneEntry
		title={entry.title}
		message={entry.message}
		diagnosticLabel={entry.diagnosticLabel}
	/>
{:else if isToolCall(entry) && entry.todos && entry.todos.length > 0}
	<AgentToolTodo todos={entry.todos} isLive={entry.status === "running"} />
{:else if isToolCall(entry) && entry.question}
	<AgentToolQuestion
		questions={[entry.question]}
		status={entry.status}
		isInteractive={entry.status === "running"}
	/>
{:else if isToolCall(entry) && (entry.kind === "read_lints" || entry.lintDiagnostics !== undefined)}
	<AgentToolReadLints
		status={entry.status}
		totalDiagnostics={entry.lintDiagnostics?.length ?? 0}
		totalFiles={lintFileCount}
		diagnostics={entry.lintDiagnostics ?? null}
		summaryLabel={`${entry.lintDiagnostics?.length ?? 0} issues in ${lintFileCount} files`}
	/>
{:else if isToolCall(entry) && entry.kind === "read"}
	<AgentToolRead
		filePath={entry.filePath}
		sourceExcerpt={entry.sourceExcerpt ?? null}
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
		searchMode={entry.searchMode}
		searchNumFiles={entry.searchNumFiles}
		searchNumMatches={entry.searchNumMatches}
		searchMatches={entry.searchMatches}
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
		resultText={entry.taskResultText}
		children={entry.taskChildren}
		status={entry.status}
		{iconBasePath}
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
		padded={true}
		{iconBasePath}
	/>
{/if}
