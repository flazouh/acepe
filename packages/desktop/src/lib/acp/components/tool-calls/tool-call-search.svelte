<script lang="ts">
import { AgentToolSearch } from "@acepe/ui/agent-panel";
import * as m from "$lib/messages.js";
import { getSessionStore } from "../../store/index.js";
import type { TurnState } from "../../store/types.js";
import type { ToolCall } from "../../types/tool-call.js";
import { getToolStatus } from "../../utils/tool-state-utils.js";
import { resolveSearchDisplayResult } from "./tool-result-display.js";

interface ToolCallSearchProps {
	toolCall: ToolCall;
	turnState?: TurnState;
	elapsedLabel?: string | null;
}

let { toolCall, turnState, elapsedLabel }: ToolCallSearchProps = $props();

const sessionStore = getSessionStore();
const toolStatus = $derived(getToolStatus(toolCall, turnState));

// Determine variant: glob kind → "glob" (Finding/Found), search → "grep" (Grepping/Grepped)
const variant = $derived(toolCall.kind === "glob" ? "glob" : "grep");

function extractQueryFromTitle(title: string | null | undefined): string | null {
	if (!title) return null;
	const trimmed = title.trim();
	if (!trimmed) return null;
	const searchInMatch = trimmed.match(/^Search\s+(.+?)\s+in\s+.+$/i);
	if (searchInMatch?.[1]) return searchInMatch[1].trim();
	const grepForMatch = trimmed.match(/^Grepp?(?:ing|ed)?(?:\s+for)?\s+(.+)$/i);
	if (grepForMatch?.[1]) return grepForMatch[1].trim();
	return null;
}

// Extract query (streaming args first for progressive display)
const query = $derived.by(() => {
	const streamingArgs = sessionStore.getStreamingArguments(toolCall.id);
	if (streamingArgs?.kind === "search" && streamingArgs.query) {
		return streamingArgs.query;
	}
	if (streamingArgs?.kind === "glob" && streamingArgs.pattern) {
		return streamingArgs.pattern;
	}
	if (toolCall.arguments.kind === "search" && toolCall.arguments.query) {
		return toolCall.arguments.query;
	}
	if (toolCall.arguments.kind === "glob" && toolCall.arguments.pattern) {
		return toolCall.arguments.pattern;
	}
	// For glob tools without a pattern (e.g. LS_DIR), use path as the query
	if (toolCall.arguments.kind === "glob" && toolCall.arguments.path) {
		return toolCall.arguments.path;
	}
	return extractQueryFromTitle(toolCall.title);
});

// Extract search path from arguments (skip if path is already shown as query)
const searchPath = $derived.by(() => {
	if (toolCall.arguments.kind === "search") {
		return toolCall.arguments.file_path ?? undefined;
	}
	if (toolCall.arguments.kind === "glob") {
		// Only show path separately if there's a pattern (otherwise path is the query)
		if (toolCall.arguments.pattern) {
			return toolCall.arguments.path ?? undefined;
		}
		return undefined;
	}
	return undefined;
});

const searchResult = $derived(resolveSearchDisplayResult(toolCall, searchPath));

// Derive file list (for files mode) and result count
const files = $derived(searchResult.files);
const resultCount = $derived(
	searchResult.mode === "content"
		? (searchResult.numMatches ?? searchResult.numFiles)
		: searchResult.files.length
);

// Map tool status to AgentToolStatus
const agentStatus = $derived.by(() => {
	if (toolStatus.isPending) return "running" as const;
	if (toolStatus.isError) return "error" as const;
	return "done" as const;
});
</script>

<AgentToolSearch
	{query}
	{searchPath}
	{files}
	resultCount={resultCount ?? 0}
	status={agentStatus}
	durationLabel={elapsedLabel ?? undefined}
	iconBasePath="/svgs/icons"
	{variant}
	findingLabel={m.tool_search_finding()}
	foundLabel={m.tool_search_found()}
	greppingLabel={m.tool_search_grepping()}
	greppedLabel={m.tool_search_grepped()}
	resultCountLabel={(count) =>
		count === 1
			? m.tool_search_result_count_one({ count })
			: m.tool_search_result_count_other({ count })}
	showMoreLabel={(count) => m.tool_search_show_more({ count })}
	showLessLabel={m.tool_search_show_less()}
	ariaExpandResults={m.aria_expand_results()}
	ariaCollapseResults={m.aria_collapse_results()}
/>
