<script lang="ts">
import { TextShimmer } from "@acepe/ui";
import { AgentToolCard } from "@acepe/ui/agent-panel";
import MagnifyingGlass from "phosphor-svelte/lib/MagnifyingGlass";
import * as m from "$lib/paraglide/messages.js";
import { getSessionStore } from "../../store/index.js";
import type { TurnState } from "../../store/types.js";
import type { ToolCall } from "../../types/tool-call.js";
import { getToolStatus } from "../../utils/tool-state-utils.js";

interface Props {
	toolCall: ToolCall;
	turnState?: TurnState;
	projectPath?: string;
	elapsedLabel?: string | null;
}

let { toolCall, turnState, elapsedLabel }: Props = $props();

const sessionStore = getSessionStore();
const toolStatus = $derived(getToolStatus(toolCall, turnState));
const isPending = $derived(toolStatus.isPending);

// Extract query (streaming args first for progressive display)
const query = $derived.by(() => {
	const streamingArgs = sessionStore.getStreamingArguments(toolCall.id);
	if (streamingArgs?.kind === "toolSearch" && streamingArgs.query) {
		return streamingArgs.query;
	}
	return toolCall.arguments.kind === "toolSearch" ? toolCall.arguments.query : null;
});

const maxResults = $derived.by(() => {
	const streamingArgs = sessionStore.getStreamingArguments(toolCall.id);
	if (streamingArgs?.kind === "toolSearch" && streamingArgs.max_results) {
		return streamingArgs.max_results;
	}
	return toolCall.arguments.kind === "toolSearch" ? toolCall.arguments.max_results : null;
});

// Parse result to extract matched tool names
const matchedTools = $derived.by(() => {
	const result = toolCall.result;
	if (!result || typeof result !== "string") return null;

	// Result contains <functions> block with tool definitions
	const matches = result.match(/<function>\s*\{[^}]*"name"\s*:\s*"([^"]+)"/g);
	if (!matches) return null;

	return matches.map((match) => {
		const nameMatch = match.match(/"name"\s*:\s*"([^"]+)"/);
		return nameMatch?.[1] ?? "unknown";
	});
});

const toolCount = $derived(matchedTools?.length ?? 0);
</script>

<AgentToolCard>
	<div class="space-y-2 p-2.5">
		<!-- Header: status label + elapsed -->
		<div class="flex items-center justify-between gap-2">
			<div class="flex items-center gap-1.5 min-w-0 text-xs">
				<MagnifyingGlass class="size-3.5 text-muted-foreground shrink-0" weight="bold" />
				<span class="font-medium shrink-0">
					{#if isPending}
						<TextShimmer class="inline-flex h-4 m-0 items-center text-xs leading-none">
							{m.tool_tool_search_running()}
						</TextShimmer>
					{:else}
						{m.tool_tool_search_completed()}
					{/if}
				</span>
			</div>

			{#if elapsedLabel}
				<span class="font-mono text-[10px] text-muted-foreground/70">{elapsedLabel}</span>
			{/if}
		</div>

		<!-- Input: query -->
		{#if query}
			<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
				<span class="shrink-0 text-muted-foreground/50">query</span>
				<code class="min-w-0 truncate rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{query}</code>
				{#if maxResults}
					<span class="shrink-0 text-muted-foreground/50">max</span>
					<code class="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{maxResults}</code>
				{/if}
			</div>
		{/if}

		<!-- Output: matched tools -->
		{#if matchedTools && matchedTools.length > 0}
			<div class="flex flex-wrap gap-1">
				{#each matchedTools as toolName}
					<span class="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
						{toolName}
					</span>
				{/each}
			</div>
		{:else if !isPending && toolCount === 0 && toolCall.result}
			<span class="text-[11px] text-muted-foreground/60">No tools matched</span>
		{/if}
	</div>
</AgentToolCard>
