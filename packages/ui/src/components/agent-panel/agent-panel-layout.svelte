<script lang="ts">
	import type { AnyAgentEntry, AgentSessionStatus } from "./types.js";
	import AgentPanelHeader from "./agent-panel-header.svelte";
	import AgentUserMessage from "./agent-user-message.svelte";
	import AgentAssistantMessage from "./agent-assistant-message.svelte";
	import AgentToolRow from "./agent-tool-row.svelte";
	import AgentToolExecute from "./agent-tool-execute.svelte";
	import AgentToolSearch from "./agent-tool-search.svelte";
	import AgentToolFetch from "./agent-tool-fetch.svelte";
	import AgentToolTask from "./agent-tool-task.svelte";
	import AgentToolWebSearch from "./agent-tool-web-search.svelte";
	import AgentInputStub from "./agent-input-stub.svelte";
	import { TextShimmer } from "../text-shimmer/index.js";

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
		/** Current mode shown in the input toolbar */
		inputMode?: "build" | "plan";
		/** Model name shown in the input toolbar */
		inputModel?: string;
		/** Placeholder in the input area */
		inputPlaceholder?: string;
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
		inputMode = "build",
		inputModel = "claude-sonnet-4-6",
		inputPlaceholder = "Message Acepe…",
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

<div class="flex flex-col h-full bg-background">
	<AgentPanelHeader
		{sessionTitle}
		{agentIconSrc}
		{sessionStatus}
		{onClose}
	/>

	<!-- Message list -->
	<div bind:this={scrollContainer} class="flex-1 min-h-0 overflow-y-auto py-1">
		{#each entries as entry (entry.id)}
			<div class="py-1.5 px-3">
				{#if entry.type === "user"}
					<AgentUserMessage text={entry.text} />
				{:else if entry.type === "assistant"}
					<AgentAssistantMessage
						markdown={entry.markdown}
						isStreaming={entry.isStreaming}
						{iconBasePath}
					/>
				{:else if entry.type === "tool_call"}
					{#if entry.kind === "execute"}
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
							{iconBasePath}
						/>
					{/if}
				{:else if entry.type === "thinking"}
					<div class="py-2 text-sm text-muted-foreground">
						<TextShimmer>Planning next moves…</TextShimmer>
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Input area — mirrors agent-input-ui.svelte structure -->
	<AgentInputStub
		placeholder={inputPlaceholder}
		mode={inputMode}
		model={inputModel}
	/>
</div>
