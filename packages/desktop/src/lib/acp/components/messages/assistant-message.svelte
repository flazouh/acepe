<script lang="ts">
import { AgentAssistantMessage, type ChunkGroup } from "@acepe/ui/agent-panel";
import { getChatPreferencesStore } from "$lib/acp/store/chat-preferences-store.svelte.js";
import type { AssistantMessage } from "../../types/assistant-message.js";
import {
DEFAULT_STREAMING_ANIMATION_MODE,
type StreamingAnimationMode,
} from "../../types/streaming-animation-mode.js";
import ContentBlockRouter from "./content-block-router.svelte";

interface Props {
message: AssistantMessage;
isStreaming?: boolean;
revealMessageKey?: string;
projectPath?: string;
streamingAnimationMode?: StreamingAnimationMode;
}

let {
message,
isStreaming = false,
revealMessageKey,
projectPath,
streamingAnimationMode = DEFAULT_STREAMING_ANIMATION_MODE,
}: Props = $props();

const chatPrefs = getChatPreferencesStore();
const initiallyCollapsed = $derived(chatPrefs?.thinkingBlockCollapsedByDefault ?? false);
</script>

<AgentAssistantMessage
{message}
{isStreaming}
{revealMessageKey}
{projectPath}
{streamingAnimationMode}
{initiallyCollapsed}
iconBasePath="/svgs/icons"
>
{#snippet renderBlock(ctx: {
group: ChunkGroup;
isStreaming?: boolean;
revealKey?: string;
projectPath?: string;
streamingAnimationMode?: StreamingAnimationMode;
onRevealActivityChange?: (active: boolean) => void;
})}
<ContentBlockRouter
block={ctx.group.type === "text" ? { type: "text", text: ctx.group.text } : ctx.group.block}
isStreaming={ctx.isStreaming}
revealKey={ctx.revealKey}
projectPath={ctx.projectPath}
streamingAnimationMode={ctx.streamingAnimationMode}
onRevealActivityChange={ctx.onRevealActivityChange}
/>
{/snippet}
</AgentAssistantMessage>
