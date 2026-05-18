<script lang="ts">
import { AgentToolThinking } from "@acepe/ui/agent-panel";
import { groupAssistantChunks } from "../../logic/assistant-chunk-grouper.js";
import { sanitizeAssistantText } from "../../logic/assistant-text-sanitizer.js";
import { getChatPreferencesStore } from "../../store/chat-preferences-store.svelte.js";
import type { AssistantMessage } from "../../types/assistant-message.js";
import {
	DEFAULT_STREAMING_ANIMATION_MODE,
	type StreamingAnimationMode,
} from "../../types/streaming-animation-mode.js";
import ContentBlockRouter from "./content-block-router.svelte";
import MessageMetaPill from "./message-meta-pill.svelte";
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
	/** Project path for opening files in panels */
	projectPath?: string;
	streamingAnimationMode?: StreamingAnimationMode;
}

let {
	message,
	isStreaming = false,
	projectPath: propProjectPath,
	streamingAnimationMode = DEFAULT_STREAMING_ANIMATION_MODE,
}: Props = $props();

const EMPTY_ASSISTANT_MESSAGE: AssistantMessage = {
	chunks: [],
};

function resolveAssistantMessage(candidate: AssistantMessage | undefined): AssistantMessage {
	if (candidate && Array.isArray(candidate.chunks)) {
		return candidate;
	}

	if (import.meta.env.DEV) {
		console.warn("[ASSISTANT_MESSAGE_INVALID_PROP]", {
			isStreaming,
			projectPath: propProjectPath,
			hasCandidate: candidate !== undefined,
		});
	}

	return EMPTY_ASSISTANT_MESSAGE;
}

const projectPath = $derived(propProjectPath);
const safeMessage = $derived(resolveAssistantMessage(message));

const groupedChunks = $derived.by(() => {
	const grouped = groupAssistantChunks(safeMessage.chunks);

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
const showThinkingBlock = $derived(hasThinking);
const visibleMessageGroups = $derived(groupedChunks.messageGroups);

/** "Thinking" or "Thinking for Xs" while streaming, "Thought" or "Thought for Xs" when done */
const thinkingHeaderLabel = $derived.by(() => {
	const ms = safeMessage.thinkingDurationMs;
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
	scrollTailToVisibleEnd(container);
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
	<div class="relative w-full mb-2 group/assistant-message">
		<div class="space-y-1.5">
			{#if showThinkingBlock}
				<AgentToolThinking
					headerLabel={thinkingHeaderLabel}
					showHeader={!isStreaming || safeMessage.thinkingDurationMs != null}
					status={isStreaming ? "running" : "done"}
					collapsed={isCollapsed}
					onCollapseChange={(next: boolean) => {
						isCollapsed = next;
					}}
					defaultExpanded={chatPrefs ? !chatPrefs.thinkingBlockCollapsedByDefault : false}
					onToggleDefaultExpand={() => {
						chatPrefs?.setThinkingBlockCollapsedByDefault(!chatPrefs.thinkingBlockCollapsedByDefault);
					}}
				>
					<div
						class="thinking-content scrollbar-none overflow-y-auto text-xs opacity-60"
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
							{projectPath}
							{streamingAnimationMode}
						/>
					{:else}
						<ContentBlockRouter block={group.block} {projectPath} />
					{/if}
				</div>
			{/each}

			{#if hasMessageContent}
				<div
					class="flex justify-end pt-1 opacity-0 transition-opacity duration-150 group-hover/assistant-message:opacity-100 group-focus-within/assistant-message:opacity-100"
				>
					<MessageMetaPill
						text={textContent}
						timestamp={safeMessage.receivedAt}
						variant="assistant"
					/>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
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
