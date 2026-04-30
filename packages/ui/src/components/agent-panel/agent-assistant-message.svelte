<script lang="ts">
import { untrack } from "svelte";
import type { Snippet } from "svelte";
import { IconCheck } from "@tabler/icons-svelte";
import { Copy } from "phosphor-svelte";
import { MarkdownDisplay } from "../markdown/index.js";
import { TextShimmer } from "../text-shimmer/index.js";
import { LoadingIcon } from "../icons/index.js";
import AgentToolThinking from "./agent-tool-thinking.svelte";
import {
groupAssistantChunks,
type ChunkGroup,
} from "../../lib/assistant-message/assistant-chunk-grouper.js";
import { sanitizeAssistantText } from "../../lib/assistant-message/assistant-text-sanitizer.js";
import {
createRafDedupeScheduler,
scrollTailToVisibleEnd,
} from "../../lib/assistant-message/thinking-viewport-follow.js";
import {
DEFAULT_THINKING_VIEWPORT_POLICY,
thinkingViewportCssText,
} from "../../lib/assistant-message/thinking-viewport-policy.js";
import type {
AssistantMessage,
StreamingAnimationMode,
} from "../../lib/assistant-message/types.js";

/**
 * Context passed to the renderBlock snippet for every chunk group.
 * When group.type === "text", group.text is the string content.
 * When group.type === "other", group.block is the non-text ContentBlock.
 */
interface RenderBlockContext {
group: ChunkGroup;
isStreaming?: boolean;
revealKey?: string;
projectPath?: string;
streamingAnimationMode?: StreamingAnimationMode;
onRevealActivityChange?: (active: boolean) => void;
}

interface Props {
message: AssistantMessage;
isStreaming?: boolean;
revealMessageKey?: string;
projectPath?: string;
streamingAnimationMode?: StreamingAnimationMode;
/** Whether the thinking block starts collapsed. Defaults to false. */
initiallyCollapsed?: boolean;
/** Base path for file type SVG icons (used by the MarkdownDisplay fallback) */
iconBasePath?: string;
/**
 * Optional snippet to render chunk groups.
 * When provided it is called for ALL groups (text and non-text), enabling hosts
 * like the desktop to use their own streaming-reveal renderer.
 * When omitted, text groups fall back to MarkdownDisplay and non-text groups
 * are silently skipped (appropriate for static website demos).
 */
renderBlock?: Snippet<[RenderBlockContext]>;
}

let {
message,
isStreaming = false,
revealMessageKey,
projectPath,
streamingAnimationMode = "smooth",
initiallyCollapsed = false,
iconBasePath = "",
renderBlock,
}: Props = $props();

const groupedChunks = $derived.by(() => {
const grouped = groupAssistantChunks(message.chunks);

if (grouped.messageGroups.length > 0 && grouped.messageGroups[0].type === "text") {
const firstGroup = grouped.messageGroups[0];
const sanitized = sanitizeAssistantText(firstGroup.text);

if (sanitized.length === 0) {
grouped.messageGroups = grouped.messageGroups.slice(1);
} else {
grouped.messageGroups[0] = { type: "text", text: sanitized };
}
}

return grouped;
});

const filteredThoughtGroups = $derived.by(() => {
const hasMessageGroups = groupedChunks.messageGroups.length > 0;
return groupedChunks.thoughtGroups.filter((group) => {
if (group.type !== "text") return true;
const trimmed = group.text.trim();
if (trimmed.length === 0) return false;
if (hasMessageGroups && !/[A-Za-z0-9]/.test(trimmed)) return false;
return true;
});
});

const textContent = $derived(
groupedChunks.messageGroups
.filter((group) => group.type === "text")
.map((group) => group.text)
.join("")
);

const lastThoughtTextGroupIndex = $derived.by(() => {
for (let index = filteredThoughtGroups.length - 1; index >= 0; index -= 1) {
if (filteredThoughtGroups[index]?.type === "text") return index;
}
return -1;
});

const lastMessageTextGroupIndex = $derived.by(() => {
for (let index = groupedChunks.messageGroups.length - 1; index >= 0; index -= 1) {
if (groupedChunks.messageGroups[index]?.type === "text") return index;
}
return -1;
});

const hasThinking = $derived(filteredThoughtGroups.length > 0);
const hasMessageContent = $derived(groupedChunks.messageGroups.length > 0);
const hasAnyContent = $derived(hasThinking || hasMessageContent);
const showThinkingBlock = $derived(hasThinking && !hasMessageContent);

let isCollapsed = $state(untrack(() => initiallyCollapsed));

$effect(() => {
isCollapsed = !isStreaming;
});

/**
 * When renderBlock is provided, trail non-text blocks are hidden while the last
 * text group's reveal animation is active (mirrors desktop streaming UX).
 */
let isMessageTextRevealActive = $state(false);

const visibleMessageGroups = $derived.by(() => {
if (!renderBlock || !isMessageTextRevealActive || lastMessageTextGroupIndex < 0) {
return groupedChunks.messageGroups;
}
return groupedChunks.messageGroups.slice(0, lastMessageTextGroupIndex + 1);
});

$effect(() => {
if (lastMessageTextGroupIndex < 0) {
isMessageTextRevealActive = false;
}
});

const thinkingHeaderLabel = $derived.by(() => {
const ms = message.thinkingDurationMs;
if (isStreaming && ms != null && ms >= 0) {
const s = Math.round(ms / 1000);
return `Thinking for ${String(s <= 1 ? 1 : s)}s`;
}
if (isStreaming) return "Thinking";
if (ms != null && ms >= 0) {
const s = Math.round(ms / 1000);
return `Thought for ${String(s <= 1 ? 1 : s)}s`;
}
return "Thought";
});

let thinkingContainerRef = $state<HTMLDivElement | undefined>();
let thinkingContentRef = $state<HTMLDivElement | undefined>();

const thinkingFollowScheduler = createRafDedupeScheduler(() => {
if (!showThinkingBlock || !isStreaming || isCollapsed) return;
const container = thinkingContainerRef;
if (!container) return;
scrollTailToVisibleEnd(container, thinkingContentRef);
});

$effect(() => {
if (showThinkingBlock && isStreaming && !isCollapsed && thinkingContainerRef) {
thinkingFollowScheduler.schedule();
}
});

$effect(() => {
if (!showThinkingBlock || !isStreaming || isCollapsed || !thinkingContainerRef) return;

const content = thinkingContentRef;
thinkingFollowScheduler.schedule();

if (!content || typeof ResizeObserver !== "function") return;

const observer = new ResizeObserver(() => {
thinkingFollowScheduler.schedule();
});
observer.observe(content);

return () => {
observer.disconnect();
thinkingFollowScheduler.cancel();
};
});

$effect(() => {
return () => {
thinkingFollowScheduler.cancel();
};
});

// Copy button
let copied = $state(false);

async function handleCopy(): Promise<void> {
if (!textContent.trim()) return;
try {
await navigator.clipboard.writeText(textContent);
copied = true;
setTimeout(() => {
copied = false;
}, 2000);
} catch {
// clipboard unavailable (e.g. non-secure context)
}
}
</script>

{#if hasAnyContent}
<div class="w-full mb-2 group/assistant-message">
<div class="space-y-1.5">
{#if showThinkingBlock}
<AgentToolThinking
headerLabel={thinkingHeaderLabel}
showHeader={!isStreaming || message.thinkingDurationMs != null}
status={isStreaming ? "running" : "done"}
collapsed={isCollapsed}
onCollapseChange={(next: boolean) => {
isCollapsed = next;
}}
>
<div
class="thinking-content scrollbar-none overflow-y-auto opacity-60"
style={thinkingViewportCssText(DEFAULT_THINKING_VIEWPORT_POLICY)}
bind:this={thinkingContainerRef}
>
<div bind:this={thinkingContentRef}>
{#each filteredThoughtGroups as group, index (index)}
{@const isLastThoughtTextGroup = index === lastThoughtTextGroupIndex}
{#if renderBlock}
{@render renderBlock({
group,
isStreaming: isStreaming && isLastThoughtTextGroup,
revealKey:
isLastThoughtTextGroup && revealMessageKey
? `${revealMessageKey}:thought:${index}`
: undefined,
projectPath,
streamingAnimationMode,
})}
{:else if group.type === "text"}
<MarkdownDisplay
	content={group.text}
	textSize="text-sm"
	class="agent-assistant-markdown"
	contentPaddingClass="p-0"
	{iconBasePath}
/>
{/if}
{/each}
</div>
</div>
</AgentToolThinking>
{/if}

{#each visibleMessageGroups as group, index (index)}
{@const isLastTextGroup = index === lastMessageTextGroupIndex}
<div class="space-y-1.5">
{#if renderBlock}
{@render renderBlock({
group,
isStreaming: isStreaming && isLastTextGroup,
revealKey:
isLastTextGroup && revealMessageKey
? `${revealMessageKey}:message:${index}`
: undefined,
projectPath,
streamingAnimationMode,
onRevealActivityChange: isLastTextGroup
? (active) => {
isMessageTextRevealActive = active;
}
: undefined,
})}
{:else if group.type === "text"}
{#if isStreaming && !group.text}
<div class="flex items-center gap-2 py-2 text-sm text-muted-foreground">
<LoadingIcon class="shrink-0" style="width: 14px; height: 14px;" aria-label="Loading" />
<TextShimmer>Planning next moves…</TextShimmer>
</div>
{:else}
<MarkdownDisplay
	content={group.text}
	textSize="text-sm"
	class="agent-assistant-markdown"
	contentPaddingClass="p-0"
	{iconBasePath}
/>
{/if}
{/if}
</div>
{/each}

{#if hasMessageContent}
<div
class="pt-1 opacity-0 transition-opacity duration-150 group-hover/assistant-message:opacity-100 group-focus-within/assistant-message:opacity-100"
>
<button
onclick={handleCopy}
title={copied ? "Copied!" : "Copy"}
class="inline-flex items-center justify-center p-0.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/50 shrink-0"
type="button"
>
{#if copied}
<IconCheck size={14} stroke={2} />
{:else}
<Copy size={14} weight="fill" />
{/if}
</button>
</div>
{/if}
</div>
</div>
{/if}

<style>
:global(.agent-assistant-markdown .markdown-content),
:global(.agent-assistant-markdown .markdown-loading) {
line-height: 1.5;
}

.thinking-content {
max-height: calc(var(--thinking-visible-lines) * var(--thinking-line-height));
line-height: var(--thinking-line-height);
scroll-snap-type: y proximity;
scroll-padding-block: 0;
}

.thinking-content :global(.markdown-content > *) {
scroll-snap-align: start;
scroll-snap-stop: normal;
}

.thinking-content :global(.markdown-content),
.thinking-content :global(.markdown-content *) {
line-height: var(--thinking-line-height) !important;
}
</style>
