<script lang="ts">
	import type {
		AgentConversationRenderKind,
		AgentToolEntry,
	} from "./agent-panel-conversation-entry-model.js";
	import type { AgentTaskDetailBinding } from "./types.js";
	import AgentToolBrowser from "./agent-tool-browser.svelte";
	import AgentToolExecute from "./agent-tool-execute.svelte";
	import AgentToolFetch from "./agent-tool-fetch.svelte";
	import AgentToolOther from "./agent-tool-other.svelte";
	import AgentToolRow from "./agent-tool-row.svelte";
	import AgentToolSearch from "./agent-tool-search.svelte";
	import AgentToolSkill from "./agent-tool-skill.svelte";
	import AgentToolTask from "./agent-tool-task.svelte";
	import AgentToolWebSearch from "./agent-tool-web-search.svelte";

	import type { ToolDurationTiming } from "./tool-duration.js";

	interface Props {
		entry: AgentToolEntry;
		renderKind: AgentConversationRenderKind;
		durationTiming?: ToolDurationTiming;
		iconBasePath?: string;
		taskDetail?: AgentTaskDetailBinding | null;
	}

	let {
		entry,
		renderKind,
		durationTiming,
		iconBasePath = "/svgs/icons",
		taskDetail = null,
	}: Props = $props();
</script>

{#if renderKind === "tool-execute"}
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
		{durationTiming}
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
		{durationTiming}
		{iconBasePath}
	/>
{:else if renderKind === "tool-fetch"}
	<AgentToolFetch
		url={entry.url ?? null}
		domain={entry.subtitle ?? null}
		resultText={entry.resultText ?? null}
		status={entry.status}
		{durationTiming}
	/>
{:else if renderKind === "tool-web-search"}
	<AgentToolWebSearch
		query={entry.query ?? entry.subtitle ?? null}
		links={entry.webSearchLinks ?? []}
		summary={entry.webSearchSummary ?? null}
		status={entry.status}
		{durationTiming}
	/>
{:else if renderKind === "tool-other"}
	<AgentToolOther
		title={entry.title}
		subtitle={entry.subtitle ?? null}
		detailsText={entry.detailsText ?? null}
		status={entry.status}
		{durationTiming}
	/>
{:else if renderKind === "tool-browser"}
	<AgentToolBrowser
		title={entry.title}
		subtitle={entry.subtitle ?? null}
		detailsText={entry.detailsText ?? null}
		scriptText={entry.scriptText ?? null}
		scriptHtml={entry.scriptHtml ?? null}
		highlightScript={entry.highlightScript ?? null}
		status={entry.status}
		{durationTiming}
	/>
{:else if renderKind === "tool-skill"}
	<AgentToolSkill
		skillName={entry.skillName}
		skillArgs={entry.skillArgs}
		description={entry.skillDescription}
		status={entry.status}
		{durationTiming}
	/>
{:else if renderKind === "tool-task"}
	<AgentToolTask
		description={entry.taskDescription ?? entry.title}
		prompt={entry.taskPrompt}
		latestAction={entry.taskLatestAction}
		detail={taskDetail}
		status={entry.status}
		{durationTiming}
		{iconBasePath}
	/>
{:else if renderKind === "tool-error-result"}
	<div class="rounded border border-destructive/30 bg-destructive/5 px-3 py-2">
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
		{durationTiming}
		padded={true}
		{iconBasePath}
	/>
{/if}
