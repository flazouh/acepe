<script lang="ts">
	import type { Snippet } from "svelte";

	import type { AnyAgentEntry, AgentSessionStatus } from "./types.js";
	import AgentPanelHeader from "./agent-panel-header.svelte";
	import AgentUserMessage from "./agent-user-message.svelte";
	import AgentAssistantMessage from "./agent-assistant-message.svelte";
	import AgentToolRow from "./agent-tool-row.svelte";
	import AgentToolRead from "./agent-tool-read.svelte";
	import AgentToolExecute from "./agent-tool-execute.svelte";
	import AgentToolSearch from "./agent-tool-search.svelte";
	import AgentToolFetch from "./agent-tool-fetch.svelte";
	import AgentToolOther from "./agent-tool-other.svelte";
	import AgentToolBrowser from "./agent-tool-browser.svelte";
	import AgentToolReadLints from "./agent-tool-read-lints.svelte";
	import AgentToolTask from "./agent-tool-task.svelte";
	import AgentToolSkill from "./agent-tool-skill.svelte";
	import AgentToolTodo from "./agent-tool-todo.svelte";
	import AgentToolWebSearch from "./agent-tool-web-search.svelte";
	import AgentSessionActivityEntry from "./agent-session-activity-entry.svelte";
	import ToolLabel from "./tool-label.svelte";

	interface Props {
		entries: AnyAgentEntry[];
		projectName?: string;
		projectColor?: string;
		sessionTitle?: string;
		agentIconSrc?: string;
		sessionStatus?: AgentSessionStatus;
		onClose?: () => void;
		/** Base path for file type SVG icons (e.g. "/svgs/icons") */
		iconBasePath?: string;
		/** Real agent input chrome (desktop: compose `agent-input-ui` here). Omit for message-only layouts. */
		inputArea?: Snippet;
	}

	let {
		entries,
		projectName,
		projectColor,
		sessionTitle,
		agentIconSrc,
		sessionStatus = "empty",
		onClose,
		iconBasePath = "/svgs/icons",
		inputArea,
	}: Props = $props();

	let scrollContainer: HTMLDivElement | null = $state(null);

	// Auto-scroll to bottom when entries change (animated demo)
	$effect(() => {
		void entries.length;
		const el = scrollContainer;
		if (el) {
			const animationFrameId = requestAnimationFrame(() => {
				el.scrollTop = el.scrollHeight;
			});
			return () => {
				cancelAnimationFrame(animationFrameId);
			};
		}
	});
</script>

<div class="flex flex-col h-full bg-accent/20">
	<AgentPanelHeader
		{sessionTitle}
		{agentIconSrc}
		{sessionStatus}
		{onClose}
	/>

	<!-- Message list -->
	<div bind:this={scrollContainer} class="flex-1 min-h-0 overflow-y-auto bg-accent/20">
		{#each entries as entry (entry.id)}
			<div class="py-1.5 px-3">
				{#if entry.type === "session_activity"}
					<AgentSessionActivityEntry
						title={entry.title}
						status={entry.status}
						subtitle={entry.subtitle}
						contextUsage={entry.contextUsage}
						metadata={entry.metadata}
					/>
				{:else if entry.type === "user"}
					<AgentUserMessage text={entry.text} chunks={entry.chunks} timestampMs={entry.timestampMs} />
				{:else if entry.type === "assistant"}
					<AgentAssistantMessage
						messageId={entry.id}
						message={{
							chunks: [{ type: "message", block: { type: "text", text: entry.markdown } }],
						}}
						isStreaming={entry.isStreaming}
						timestampMs={entry.timestampMs}
						{iconBasePath}
					/>
				{:else if entry.type === "tool_call"}
					{#if entry.kind === "read_lints"}
						<AgentToolReadLints
							status={entry.status}
							totalDiagnostics={entry.lintDiagnostics?.length ?? 0}
							totalFiles={0}
							diagnostics={entry.lintDiagnostics ?? null}
						/>
					{:else if entry.kind === "read"}
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
					{:else if entry.kind === "execute"}
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
					{:else if entry.kind === "search"}
						<AgentToolSearch
							query={entry.query ?? null}
							searchPath={entry.searchPath}
							files={entry.searchFiles}
							resultCount={entry.searchResultCount}
							status={entry.status}
							{iconBasePath}
						/>
					{:else if entry.kind === "fetch"}
						<AgentToolFetch
							url={entry.url ?? null}
							domain={entry.subtitle ?? null}
							resultText={entry.resultText ?? null}
							status={entry.status}
						/>
					{:else if entry.kind === "web_search"}
						<AgentToolWebSearch
							query={entry.query ?? entry.subtitle ?? null}
							links={entry.webSearchLinks ?? []}
							summary={entry.webSearchSummary ?? null}
							status={entry.status}
						/>
					{:else if entry.kind === "other"}
						<AgentToolOther
							title={entry.title}
							subtitle={entry.subtitle ?? null}
							detailsText={entry.detailsText ?? null}
							status={entry.status}
						/>
					{:else if entry.kind === "browser"}
						<AgentToolBrowser
							title={entry.title}
							subtitle={entry.subtitle ?? null}
							detailsText={entry.detailsText ?? null}
							scriptText={entry.scriptText ?? null}
							scriptHtml={entry.scriptHtml ?? null}
							highlightScript={entry.highlightScript ?? null}
							status={entry.status}
						/>
					{:else if entry.kind === "skill"}
						<AgentToolSkill
							skillName={entry.skillName}
							skillArgs={entry.skillArgs}
							description={entry.skillDescription}
							status={entry.status}
						/>
					{:else if entry.todos && entry.todos.length > 0}
						<AgentToolTodo todos={entry.todos} isLive={entry.status === "running"} />
					{:else if entry.kind === "task"}
						<AgentToolTask
							description={entry.taskDescription ?? entry.title}
							prompt={entry.taskPrompt}
							latestAction={entry.taskLatestAction}
							status={entry.status}
							{iconBasePath}
						/>
					{:else}
						<AgentToolRow
							title={entry.title}
							subtitle={entry.subtitle}
							filePath={entry.filePath}
							status={entry.status}
							padded={true}
							{iconBasePath}
						/>
					{/if}
				{:else if entry.type === "thinking"}
					<div class="flex items-center gap-2 py-2 text-sm text-muted-foreground">
						<ToolLabel status="running" size="sm">
							{entry.label ?? "Planning next moves"}
						</ToolLabel>
					</div>
				{/if}
			</div>
		{/each}
	</div>

	{#if inputArea}
		<div class="shrink-0 bg-accent/20">
			{@render inputArea()}
		</div>
	{/if}
</div>
