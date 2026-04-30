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
	import { TextShimmer } from "../text-shimmer/index.js";
	import { LoadingIcon } from "../icons/index.js";

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
		iconBasePath = "",
		inputArea,
	}: Props = $props();

	let scrollContainer: HTMLDivElement | null = $state(null);

	// Auto-scroll to bottom when entries change (animated demo)
	$effect(() => {
		void entries.length;
		const el = scrollContainer;
		if (el) {
			requestAnimationFrame(() => {
				el.scrollTop = el.scrollHeight;
			});
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
				{#if entry.type === "user"}
					<AgentUserMessage text={entry.text} />
				{:else if entry.type === "assistant"}
					<AgentAssistantMessage
						message={{
							chunks: [{ type: "message", block: { type: "text", text: entry.markdown } }],
						}}
						isStreaming={entry.isStreaming}
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
							filePath={entry.filePath}
							status={entry.status}
							{iconBasePath}
						/>
					{:else if entry.kind === "execute"}
						<AgentToolExecute
							command={entry.command ?? null}
							stdout={entry.stdout}
							stderr={entry.stderr}
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
							resultText={entry.taskResultText}
							children={entry.taskChildren}
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
						<LoadingIcon class="shrink-0" style="width: 14px; height: 14px;" aria-label="Loading" />
						<TextShimmer>Planning next moves…</TextShimmer>
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
