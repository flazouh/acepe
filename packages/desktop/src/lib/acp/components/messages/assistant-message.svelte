<script lang="ts" module>
const persistedThinkingCollapseByMessageId = new Map<string, boolean>();
</script>

<script lang="ts">
import { AgentToolThinking, AgentThinkingDurationHeader } from "@acepe/ui/agent-panel";
import { getChatPreferencesStore } from "../../store/chat-preferences-store.svelte.js";
import type { AssistantMessage } from "../../types/assistant-message.js";
import {
	DEFAULT_STREAMING_ANIMATION_MODE,
	type StreamingAnimationMode,
} from "../../types/streaming-animation-mode.js";
import { buildAssistantMessageDisplayState } from "./assistant-message-state.js";
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
	messageId?: string;
	message: AssistantMessage;
	/** Whether this message is currently streaming */
	isStreaming?: boolean;
	/** Project path for opening files in panels */
	projectPath?: string;
	streamingAnimationMode?: StreamingAnimationMode;
}

let {
	messageId,
	message,
	isStreaming = false,
	projectPath: propProjectPath,
	streamingAnimationMode = DEFAULT_STREAMING_ANIMATION_MODE,
}: Props = $props();

function warnInvalidAssistantMessage(candidate: AssistantMessage | undefined): void {
	if (import.meta.env.DEV) {
		console.warn("[ASSISTANT_MESSAGE_INVALID_PROP]", {
			isStreaming,
			projectPath: propProjectPath,
			hasCandidate: candidate !== undefined,
		});
	}
}

const projectPath = $derived(propProjectPath);
const messageState = $derived.by(() =>
	buildAssistantMessageDisplayState({
		message,
		isStreaming,
		onInvalidMessage: warnInvalidAssistantMessage,
	})
);

let thinkingContainerRef = $state<HTMLDivElement | undefined>();
let thinkingContentRef = $state<HTMLDivElement | undefined>();

const thinkingFollowScheduler = createRafDedupeScheduler(() => {
	if (!messageState.showThinkingBlock || !isStreaming || isCollapsed) {
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

function persistThinkingCollapse(next: boolean): void {
	if (messageId !== undefined) {
		persistedThinkingCollapseByMessageId.set(messageId, next);
	}
}

$effect(() => {
	const prefs = chatPrefs;
	if (hasInitializedCollapse) return;
	if (messageId !== undefined && persistedThinkingCollapseByMessageId.has(messageId)) {
		isCollapsed = persistedThinkingCollapseByMessageId.get(messageId) === true;
		hasInitializedCollapse = true;
		return;
	}
	// No store (e.g. test harness): default expanded
	if (!prefs) {
		hasInitializedCollapse = true;
		return;
	}
	if (prefs.isReady) {
		isCollapsed = isStreaming ? false : prefs.thinkingBlockCollapsedByDefault;
		persistThinkingCollapse(isCollapsed);
		hasInitializedCollapse = true;
	}
});

$effect(() => {
	if (messageState.showThinkingBlock && isStreaming && !isCollapsed && thinkingContainerRef) {
		scheduleThinkingFollow();
	}
});

$effect(() => {
	if (!messageState.showThinkingBlock || !isStreaming || isCollapsed || !thinkingContainerRef) {
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

{#if messageState.hasAnyContent}
	<!-- Assistant message - full width -->
	<div class="relative w-full mb-2 group/assistant-message">
		<div class="space-y-1.5">
			{#if messageState.showThinkingBlock}
				<AgentToolThinking
					showHeader={!isStreaming || messageState.safeMessage.thinkingDurationMs != null}
					status={isStreaming ? "running" : "done"}
					collapsed={isCollapsed}
					onCollapseChange={(next: boolean) => {
						isCollapsed = next;
						persistThinkingCollapse(next);
					}}
					defaultExpanded={chatPrefs ? !chatPrefs.thinkingBlockCollapsedByDefault : false}
					onToggleDefaultExpand={() => {
						chatPrefs?.setThinkingBlockCollapsedByDefault(!chatPrefs.thinkingBlockCollapsedByDefault);
					}}
				>
					{#snippet header()}
						<AgentThinkingDurationHeader
							{isStreaming}
							thinkingDurationMs={messageState.safeMessage.thinkingDurationMs}
						/>
					{/snippet}
					<div
						class="thinking-content scrollbar-none overflow-y-auto text-xs opacity-60"
						style={thinkingViewportCssText(DEFAULT_THINKING_VIEWPORT_POLICY)}
						bind:this={thinkingContainerRef}
					>
						<div bind:this={thinkingContentRef}>
							{#each messageState.filteredThoughtGroups as group, index (index)}
								{@const isLastThoughtTextGroup = index === messageState.lastThoughtTextGroupIndex}
								{#if group.type === "text"}
									<ContentBlockRouter
										block={{ type: "text", text: group.text }}
										isStreaming={isStreaming && !messageState.hasMessageContent && isLastThoughtTextGroup}
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

			{#each messageState.visibleMessageGroups as group, index (index)}
				{@const isLastTextGroup = index === messageState.lastMessageTextGroupIndex}
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

			{#if messageState.hasMessageContent}
				<div
					class="flex justify-end pt-1 opacity-0 transition-opacity duration-150 group-hover/assistant-message:opacity-100 group-focus-within/assistant-message:opacity-100"
				>
					<MessageMetaPill
						text={messageState.textContent}
						timestamp={messageState.safeMessage.receivedAt}
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
