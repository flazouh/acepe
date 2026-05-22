<script lang="ts">
	import type {
		AgentConversationRenderKind,
		AgentToolEntry,
	} from "./agent-panel-conversation-entry-model.js";
	import AgentToolBrowser from "./agent-tool-browser.svelte";
	import AgentToolExecute from "./agent-tool-execute.svelte";
	import AgentToolFetch from "./agent-tool-fetch.svelte";
	import AgentToolOther from "./agent-tool-other.svelte";
	import AgentToolRow from "./agent-tool-row.svelte";
	import AgentToolSearch from "./agent-tool-search.svelte";
	import AgentToolSkill from "./agent-tool-skill.svelte";
	import AgentToolTask from "./agent-tool-task.svelte";
	import AgentToolWebSearch from "./agent-tool-web-search.svelte";

	interface Props {
		entry: AgentToolEntry;
		renderKind: AgentConversationRenderKind;
		durationLabel?: string;
		iconBasePath?: string;
	}

	let {
		entry,
		renderKind,
		durationLabel,
		iconBasePath = "",
	}: Props = $props();
</script>

{#if renderKind === "tool-execute"}
	<AgentToolExecute
		command={entry.command ?? null}
		commandHtmls={entry.commandHtmls}
		stdout={entry.stdout}
		stderr={entry.stderr}
		exitCode={entry.exitCode}
		status={entry.status}
		{durationLabel}
	/>
{:else if renderKind === "tool-search"}
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
		{durationLabel}
		{iconBasePath}
	/>
{:else if renderKind === "tool-fetch"}
	<AgentToolFetch
		url={entry.url ?? null}
		domain={entry.subtitle ?? null}
		resultText={entry.resultText ?? null}
		status={entry.status}
		{durationLabel}
	/>
{:else if renderKind === "tool-web-search"}
	<AgentToolWebSearch
		query={entry.query ?? entry.subtitle ?? null}
		links={entry.webSearchLinks ?? []}
		summary={entry.webSearchSummary ?? null}
		status={entry.status}
		{durationLabel}
	/>
{:else if renderKind === "tool-other"}
	<AgentToolOther
		title={entry.title}
		subtitle={entry.subtitle ?? null}
		detailsText={entry.detailsText ?? null}
		status={entry.status}
		{durationLabel}
	/>
{:else if renderKind === "tool-browser"}
	<AgentToolBrowser
		title={entry.title}
		subtitle={entry.subtitle ?? null}
		detailsText={entry.detailsText ?? null}
		status={entry.status}
		{durationLabel}
	/>
{:else if renderKind === "tool-skill"}
	<AgentToolSkill
		skillName={entry.skillName}
		skillArgs={entry.skillArgs}
		description={entry.skillDescription}
		status={entry.status}
		{durationLabel}
	/>
{:else if renderKind === "tool-task"}
	<AgentToolTask
		description={entry.taskDescription ?? entry.title}
		prompt={entry.taskPrompt}
		resultText={entry.taskResultText}
		children={entry.taskChildren}
		status={entry.status}
		{durationLabel}
		{iconBasePath}
	/>
{:else if renderKind === "tool-error-result"}
	<div class="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
		<p class="text-sm font-medium text-destructive">{entry.title}</p>
		{#if entry.subtitle}
			<p class="mt-1 text-sm text-muted-foreground">{entry.subtitle}</p>
		{/if}
		<p class="mt-2 whitespace-pre-wrap text-sm text-foreground">{entry.resultText}</p>
	</div>
{:else}
	<AgentToolRow
		title={entry.title}
		subtitle={entry.subtitle}
		filePath={entry.filePath}
		status={entry.status}
		kind={entry.kind}
		{durationLabel}
		padded={true}
		{iconBasePath}
	/>
{/if}
