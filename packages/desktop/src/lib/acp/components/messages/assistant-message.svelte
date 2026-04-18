<script lang="ts">
import { AgentToolThinking } from "@acepe/ui/agent-panel";
import { useSessionContext } from "../../hooks/use-session-context.js";
import { groupAssistantChunks } from "../../logic/assistant-chunk-grouper.js";
import { sanitizeAssistantText } from "../../logic/assistant-text-sanitizer.js";
import { getChatPreferencesStore } from "../../store/chat-preferences-store.svelte.js";
import type { AssistantMessage } from "../../types/assistant-message.js";
import {
	DEFAULT_STREAMING_ANIMATION_MODE,
	type StreamingAnimationMode,
} from "../../types/streaming-animation-mode.js";
import ContentBlockRouter from "./content-block-router.svelte";
import CopyButton from "./copy-button.svelte";
import {
	createRafDedupeScheduler,
	scrollTailToVisibleEnd,
} from "./logic/thinking-viewport-follow.js";
import {
	DEFAULT_THINKING_VIEWPORT_POLICY,
	thinkingViewportCssText,
} from "./logic/thinking-viewport-policy.js";

interface Props {
	message: AssistantMessage;
	/** Whether this message is currently streaming */
	isStreaming?: boolean;
	/** Stable entry key used to seed streaming reveal state across remounts */
	revealMessageKey?: string;
	/** Project path for opening files in panels */
	projectPath?: string;
	streamingAnimationMode?: StreamingAnimationMode;
}

let {
	message,
	isStreaming = false,
	revealMessageKey,
	projectPath: propProjectPath,
	streamingAnimationMode = DEFAULT_STREAMING_ANIMATION_MODE,
}: Props = $props();

// Get projectPath from session context, with prop fallback
const sessionContext = useSessionContext();
const projectPath = $derived(propProjectPath ?? sessionContext?.projectPath);

const groupedChunks = $derived.by(() => {
	const grouped = groupAssistantChunks(message.chunks);

	// Sanitize the first text group in message chunks
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
		// Drop punctuation-only thought tails that sometimes arrive after real assistant text.
		if (hasMessageGroups && !/[A-Za-z0-9]/.test(trimmed)) {
			return false;
		}
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
		if (filteredThoughtGroups[index]?.type === "text") {
			return index;
		}
	}

	return -1;
});
const lastMessageTextGroupIndex = $derived.by(() => {
	for (let index = groupedChunks.messageGroups.length - 1; index >= 0; index -= 1) {
		if (groupedChunks.messageGroups[index]?.type === "text") {
			return index;
		}
	}

	return -1;
});

const hasThinking = $derived(filteredThoughtGroups.length > 0);
const hasMessageContent = $derived(groupedChunks.messageGroups.length > 0);
const hasAnyContent = $derived(hasThinking || hasMessageContent);
/** Show thinking block only while there is no assistant message content yet; hide once reply text starts. */
const showThinkingBlock = $derived(hasThinking && !hasMessageContent);
let isMessageTextRevealActive = $state(false);
const visibleMessageGroups = $derived.by(() => {
	if (!isMessageTextRevealActive || lastMessageTextGroupIndex < 0) {
		return groupedChunks.messageGroups;
	}

	return groupedChunks.messageGroups.slice(0, lastMessageTextGroupIndex + 1);
});

/** "Thinking" or "Thinking for Xs" while streaming, "Thought" or "Thought for Xs" when done */
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
	if (!showThinkingBlock || !isStreaming || isCollapsed) {
		return;
	}
	const container = thinkingContainerRef;
	if (!container) {
		return;
	}
	scrollTailToVisibleEnd(container, thinkingContentRef);
});

function scheduleThinkingFollow(): void {
	thinkingFollowScheduler.schedule();
}

const chatPrefs = getChatPreferencesStore();
let isCollapsed = $state(false);
let hasInitializedCollapse = $state(false);

$effect(() => {
	const prefs = chatPrefs;
	if (hasInitializedCollapse) return;
	// No store (e.g. test harness): default expanded
	if (!prefs) {
		hasInitializedCollapse = true;
		return;
	}
	if (prefs.isReady) {
		isCollapsed = prefs.thinkingBlockCollapsedByDefault;
		hasInitializedCollapse = true;
	}
});

$effect(() => {
	if (!hasInitializedCollapse) return;
	isCollapsed = !isStreaming;
});

$effect(() => {
	if (lastMessageTextGroupIndex >= 0) {
		return;
	}

	isMessageTextRevealActive = false;
});

$effect(() => {
	if (showThinkingBlock && isStreaming && !isCollapsed && thinkingContainerRef) {
		scheduleThinkingFollow();
	}
});

$effect(() => {
	if (!showThinkingBlock || !isStreaming || isCollapsed || !thinkingContainerRef) {
		return;
	}

	const content = thinkingContentRef;
	scheduleThinkingFollow();

	if (!content || typeof ResizeObserver !== "function") {
		return;
	}

	const observer = new ResizeObserver(() => {
		scheduleThinkingFollow();
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
	<!-- Assistant message - full width -->
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
								{#if group.type === "text"}
									<ContentBlockRouter
										block={{ type: "text", text: group.text }}
										isStreaming={isStreaming && isLastThoughtTextGroup}
										revealKey={
											isLastThoughtTextGroup && revealMessageKey
												? `${revealMessageKey}:thought:${index}`
												: undefined
										}
										{projectPath}
										{streamingAnimationMode}
									/>
								{:else}
									<ContentBlockRouter block={group.block} {projectPath} />
								{/if}
							{/each}
						</div>
					</div>
				</AgentToolThinking>
			{/if}

			{#each visibleMessageGroups as group, index (index)}
				{@const isLastTextGroup = index === lastMessageTextGroupIndex}
				<div class="space-y-1.5">
					{#if group.type === "text"}
						<ContentBlockRouter
							block={{ type: "text", text: group.text }}
							isStreaming={isStreaming && isLastTextGroup}
							revealKey={
								isLastTextGroup && revealMessageKey
									? `${revealMessageKey}:message:${index}`
									: undefined
							}
							{projectPath}
							{streamingAnimationMode}
							onRevealActivityChange={(active) => {
								if (isLastTextGroup) {
									isMessageTextRevealActive = active;
								}
							}}
						/>
					{:else}
						<ContentBlockRouter block={group.block} {projectPath} />
					{/if}
				</div>
			{/each}

			{#if hasMessageContent}
				<div
					class="pt-1 opacity-0 transition-opacity duration-150 group-hover/assistant-message:opacity-100 group-focus-within/assistant-message:opacity-100"
				>
					<CopyButton text={textContent} size={14} variant="inline" />
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* Line budget vars: packages/desktop/.../logic/thinking-viewport-policy.ts (DEFAULT_THINKING_VIEWPORT_POLICY) */	.thinking-content {
		max-height: calc(var(--thinking-visible-lines) * var(--thinking-line-height));
		line-height: var(--thinking-line-height);
		/* Block-level snap: reduces mid-block clipping at the top when scrolling */
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
