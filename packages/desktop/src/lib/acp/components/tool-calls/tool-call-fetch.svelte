<script lang="ts">
import { AgentToolFetch } from "@acepe/ui/agent-panel";
import { Result } from "neverthrow";
import { getSessionStore } from "../../store/index.js";
import type { TurnState } from "../../store/types.js";
import type { ToolCall } from "../../types/tool-call.js";
import { getToolStatus } from "../../utils/tool-state-utils.js";
import { resolveFetchResultText } from "./tool-result-display.js";

interface Props {
	toolCall: ToolCall;
	turnState?: TurnState;
	elapsedLabel?: string | null;
}

let { toolCall, turnState, elapsedLabel }: Props = $props();

const sessionStore = getSessionStore();
const toolStatus = $derived(getToolStatus(toolCall, turnState));

// Extract URL (streaming args first for progressive display)
const url = $derived.by(() => {
	const streamingArgs = sessionStore.getStreamingArguments(toolCall.id);
	if (streamingArgs?.kind === "fetch" && streamingArgs.url) {
		return streamingArgs.url;
	}
	return toolCall.arguments.kind === "fetch" ? toolCall.arguments.url : null;
});

// Extract domain from URL for subtitle
const domain = $derived.by(() => {
	if (!url) return undefined;
	return Result.fromThrowable(
		() => new URL(url),
		() => new Error("invalid")
	)()
		.map((u: URL) => u.hostname.replace(/^www\./, ""))
		.unwrapOr(url);
});

const resultText = $derived(resolveFetchResultText(toolCall));

// Map tool status to AgentToolStatus
const agentStatus = $derived.by(() => {
	if (toolStatus.isPending) return "running" as const;
	if (toolStatus.isError) return "error" as const;
	return "done" as const;
});
</script>

<AgentToolFetch
	url={url ?? null}
	domain={domain ?? null}
	{resultText}
	status={agentStatus}
	durationLabel={elapsedLabel ?? undefined}
	fetchingLabel={"Fetching"}
	fetchFailedLabel={"Fetch failed"}
	fetchedLabel={"Fetched"}
	resultLabel={"Result"}
	errorLabel={"Error"}
/>
