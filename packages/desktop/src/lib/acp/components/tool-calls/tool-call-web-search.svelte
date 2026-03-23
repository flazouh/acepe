<script lang="ts">
import { AgentToolWebSearch } from "@acepe/ui/agent-panel";
import * as m from "$lib/paraglide/messages.js";
import { getPanelStore, getSessionStore } from "../../store/index.js";
import type { TurnState } from "../../store/types.js";
import type { ToolCall } from "../../types/tool-call.js";
import { getToolStatus } from "../../utils/tool-state-utils.js";
import { parseWebSearchResult } from "./tool-call-web-search/logic/parse-web-search-result.js";

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

// Parse structured search results
const searchResult = $derived(parseWebSearchResult(toolCall.result));

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
	searchingLabel={m.tool_web_search_searching()}
	searchFailedLabel={m.tool_web_search_failed()}
	searchedLabel={m.tool_web_search_searched()}
	noResultsLabel={m.tool_web_search_no_results_label()}
	resultCountLabel={(count) =>
		count === 1
			? m.tool_web_search_result_count_one({ count })
			: m.tool_web_search_result_count_other({ count })}
	showMoreCollapsedLabel={(count) => m.tool_web_search_show_more({ count })}
	showLessCollapsedLabel={m.tool_web_search_show_less()}
	showMoreExpandedLabel={(count) => m.tool_web_search_show_more_expanded({ count })}
	showLessExpandedLabel={m.tool_web_search_show_less_expanded()}
	ariaExpandResults={m.aria_expand_results()}
	ariaCollapseResults={m.aria_collapse_results()}
/>
