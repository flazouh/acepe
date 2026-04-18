<script lang="ts">
import { AgentToolWebSearch } from "@acepe/ui/agent-panel";
import { getPanelStore, getSessionStore } from "../../store/index.js";
import type { TurnState } from "../../store/types.js";
import type { ToolCall } from "../../types/tool-call.js";
import { getToolStatus } from "../../utils/tool-state-utils.js";
import { resolveWebSearchDisplayResult } from "./tool-result-display.js";

interface Props {
	toolCall: ToolCall;
	turnState?: TurnState;
	elapsedLabel?: string | null;
	/** Project path for opening links in browser panel (session context) */
	projectPath?: string;
}

let { toolCall, turnState, elapsedLabel, projectPath }: Props = $props();

const sessionStore = getSessionStore();
const panelStore = getPanelStore();
const toolStatus = $derived(getToolStatus(toolCall, turnState));

function extractQueryFromTitle(title: string | null | undefined): string | null {
	if (!title) return null;
	const trimmed = title.trim();
	if (!trimmed) return null;
	const searchingForMatch = trimmed.match(/^Searching for:\s*(.+)$/i);
	if (searchingForMatch?.[1]) return searchingForMatch[1].trim();
	const genericTitles = new Set(["Searching the Web", "Search"]);
	if (genericTitles.has(trimmed)) return null;
	return trimmed;
}

// Extract query (streaming args first for progressive display)
const query = $derived.by(() => {
	const streamingArgs = sessionStore.getStreamingArguments(toolCall.id);
	if (streamingArgs?.kind === "webSearch" && streamingArgs.query) {
		return streamingArgs.query;
	}
	if (toolCall.arguments.kind === "webSearch" && toolCall.arguments.query) {
		return toolCall.arguments.query;
	}
	return extractQueryFromTitle(toolCall.title);
});

const searchResult = $derived(resolveWebSearchDisplayResult(toolCall));

// Map tool status to AgentToolStatus
const agentStatus = $derived.by(() => {
	if (toolStatus.isPending) return "running" as const;
	if (toolStatus.isError) return "error" as const;
	return "done" as const;
});
</script>

<AgentToolWebSearch
	query={query ?? null}
	links={searchResult.links}
	summary={searchResult.summary}
	status={agentStatus}
	durationLabel={elapsedLabel ?? undefined}
	onLinkClick={(url, title) => panelStore.openBrowserPanel(projectPath ?? "", url, title)}
	searchingLabel={"Searching"}
	searchFailedLabel={"Search Failed"}
	searchedLabel={"Searched"}
	noResultsLabel={"No results"}
	resultCountLabel={(count) =>
		count === 1
			? `${count} result`
			: `${count} results`}
	showMoreCollapsedLabel={(count) => `+${count} more`}
	showLessCollapsedLabel={"show less"}
	showMoreExpandedLabel={(count) => `Show ${count} more`}
	showLessExpandedLabel={"Show less"}
	ariaExpandResults={"Expand results"}
	ariaCollapseResults={"Collapse results"}
/>
