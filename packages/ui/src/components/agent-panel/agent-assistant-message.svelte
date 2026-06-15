<script lang="ts" module>
const persistedThinkingCollapseByMessageId = new Map<string, boolean>();
</script>

<script lang="ts">
import { untrack } from "svelte";
import type { Snippet } from "svelte";
import { MarkdownDisplay } from "../markdown/index.js";
import AgentToolThinking from "./agent-tool-thinking.svelte";
import AgentMessageMeta from "./agent-message-meta.svelte";
import ToolHeaderLeading from "./tool-header-leading.svelte";
import {
findLastTextGroupIndex,
getAssistantMessageContentFlags,
getAssistantTextContent,
getFilteredAssistantThoughtGroups,
getSanitizedAssistantChunkGroups,
getThinkingHeaderLabel,
} from "./agent-assistant-message-state.js";
import type { ChunkGroup } from "../../lib/assistant-message/assistant-chunk-grouper.js";
import {
resolveVisibleAssistantMessageGroups,
shouldStreamAssistantTextContent,
shouldStreamAssistantThoughtContent,
} from "./agent-assistant-message-visible-groups.js";
import {
createRafDedupeScheduler,
scrollTailToVisibleEnd,
} from "../../lib/assistant-message/thinking-viewport-follow.js";
import {
DEFAULT_THINKING_VIEWPORT_POLICY,
thinkingViewportCssText,
} from "../../lib/assistant-message/thinking-viewport-policy.js";
import { getThinkingPreferences } from "../../lib/thinking-preferences-context.js";
import type {
	AssistantMessage,
	StreamingAnimationMode,
} from "../../lib/assistant-message/types.js";
import type { TokenRevealCss } from "./types.js";

/**
 * Context passed to the renderBlock snippet for every chunk group.
 * When group.type === "text", group.text is the string content.
 * When group.type === "other", group.block is the non-text ContentBlock.
 */
interface RenderBlockContext {
	group: ChunkGroup;
	isStreaming?: boolean;
	tokenRevealCss?: TokenRevealCss;
	projectPath?: string;
	streamingAnimationMode?: StreamingAnimationMode;
}

interface Props {
	messageId?: string;
	message: AssistantMessage;
	isStreaming?: boolean;
	tokenRevealCss?: TokenRevealCss;
	projectPath?: string;
	timestampMs?: number;
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
	messageId,
	message,
	isStreaming = false,
	tokenRevealCss,
	projectPath,
	timestampMs,
	streamingAnimationMode = "smooth",
	initiallyCollapsed,
	iconBasePath = "",
	renderBlock,
}: Props = $props();

const groupedChunks = $derived.by(() => {
	return getSanitizedAssistantChunkGroups(message);
});

const filteredThoughtGroups = $derived.by(() => {
	return getFilteredAssistantThoughtGroups({
		thoughtGroups: groupedChunks.thoughtGroups,
		hasMessageGroups: groupedChunks.messageGroups.length > 0,
	});
});

const textContent = $derived(getAssistantTextContent(groupedChunks.messageGroups));

const lastThoughtTextGroupIndex = $derived(findLastTextGroupIndex(filteredThoughtGroups));

const lastMessageTextGroupIndex = $derived(findLastTextGroupIndex(groupedChunks.messageGroups));

const contentFlags = $derived(
	getAssistantMessageContentFlags({
		filteredThoughtGroups,
		messageGroups: groupedChunks.messageGroups,
	})
);
const hasMessageContent = $derived(contentFlags.hasMessageContent);
const hasAnyContent = $derived(contentFlags.hasAnyContent);
const showThinkingBlock = $derived(contentFlags.showThinkingBlock);

const thinkingPrefs = getThinkingPreferences();

function resolveInitialCollapsed(): boolean {
	if (messageId !== undefined && persistedThinkingCollapseByMessageId.has(messageId)) {
		return persistedThinkingCollapseByMessageId.get(messageId) === true;
	}
	if (initiallyCollapsed !== undefined) {
		return initiallyCollapsed;
	}
	if (isStreaming) {
		return false;
	}
	return !(thinkingPrefs?.defaultExpanded ?? true);
}

let isCollapsed = $state(untrack(resolveInitialCollapsed));

function persistThinkingCollapse(next: boolean): void {
	if (messageId !== undefined) {
		persistedThinkingCollapseByMessageId.set(messageId, next);
	}
}

const visibleMessageGroups = $derived.by(() => {
	return resolveVisibleAssistantMessageGroups({
		messageGroups: groupedChunks.messageGroups,
		isStreaming,
		tokenRevealCss,
		lastMessageTextGroupIndex,
	});
});

const activeTokenRevealCss = $derived(isStreaming ? tokenRevealCss : undefined);

const thinkingHeaderLabel = $derived(
	getThinkingHeaderLabel({
		isStreaming,
		thinkingDurationMs: message.thinkingDurationMs,
	})
);

let thinkingContainerRef = $state<HTMLDivElement | undefined>();
let thinkingContentRef = $state<HTMLDivElement | undefined>();

const thinkingFollowScheduler = createRafDedupeScheduler(() => {
	if (!showThinkingBlock || !isStreaming || isCollapsed) return;
	const container = thinkingContainerRef;
	if (!container) return;
	scrollTailToVisibleEnd(container);
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
persistThinkingCollapse(next);
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
								isStreaming: shouldStreamAssistantThoughtContent({
									isStreaming,
									hasMessageContent,
									isLastThoughtTextGroup,
								}),
								tokenRevealCss: undefined,
								projectPath,
								streamingAnimationMode,
							})}
{:else if group.type === "text"}
<MarkdownDisplay
	content={group.text}
	textSize="text-xs"
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
				isStreaming: shouldStreamAssistantTextContent({
					isStreaming: isStreaming && isLastTextGroup,
					tokenRevealCss: isLastTextGroup ? activeTokenRevealCss : undefined,
				}),
				tokenRevealCss: isLastTextGroup ? activeTokenRevealCss : undefined,
				projectPath,
				streamingAnimationMode,
			})}
{:else if group.type === "text"}
{#if isStreaming && !group.text}
<div class="flex items-center gap-2 py-2 text-sm text-muted-foreground">
<ToolHeaderLeading kind="think" status="running">Planning next moves…</ToolHeaderLeading>
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
class="flex justify-end pt-1 opacity-0 transition-opacity duration-150 group-hover/assistant-message:opacity-100 group-focus-within/assistant-message:opacity-100"
>
<AgentMessageMeta
text={textContent}
timestampMs={timestampMs ?? message.receivedAt?.getTime()}
variant="assistant"
model={message.displayModel}
/>
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
line-height: var(--thinking-line-height);
}

.thinking-content :global(.markdown-content),
.thinking-content :global(.markdown-content *) {
	font-size: inherit !important;
	line-height: var(--thinking-line-height) !important;
}

.thinking-content :global(.markdown-content) {
	color: inherit !important;
}

.thinking-content :global(.markdown-content p),
.thinking-content :global(.markdown-content ul),
.thinking-content :global(.markdown-content ol),
.thinking-content :global(.markdown-content pre),
.thinking-content :global(.markdown-content blockquote),
.thinking-content :global(.markdown-content [data-streamdown="code-block"]),
.thinking-content :global(.markdown-content [data-streamdown="unordered-list"]),
.thinking-content :global(.markdown-content [data-streamdown="ordered-list"]),
.thinking-content :global(.markdown-content .streamdown-content > :not(:last-child)) {
	margin-block-start: 0 !important;
	margin-block-end: 0.125rem !important;
}

.thinking-content :global(.markdown-content .streamdown-content > * + *) {
	margin-block-start: 0 !important;
}

.thinking-content :global(.markdown-content li),
.thinking-content :global(.markdown-content [data-streamdown="list-item"]) {
	margin-block-end: 0.0625rem !important;
}
</style>
