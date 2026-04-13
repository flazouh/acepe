<script lang="ts">
import { AgentToolThinking } from "@acepe/ui/agent-panel";
import * as m from "$lib/messages.js";
import { useSessionContext } from "../../hooks/use-session-context.js";
import { groupAssistantChunks } from "../../logic/assistant-chunk-grouper.js";
import { sanitizeAssistantText } from "../../logic/assistant-text-sanitizer.js";
import { getChatPreferencesStore } from "../../store/chat-preferences-store.svelte.js";
import type { AssistantMessage } from "../../types/assistant-message.js";
import ContentBlockRouter from "./content-block-router.svelte";
import CopyButton from "./copy-button.svelte";

interface Props {
	message: AssistantMessage;
	/** Whether this message is currently streaming */
	isStreaming?: boolean;
	/** Project path for opening files in panels */
	projectPath?: string;
}

let { message, isStreaming = false, projectPath: propProjectPath }: Props = $props();

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

const hasThinking = $derived(filteredThoughtGroups.length > 0);
const hasMessageContent = $derived(groupedChunks.messageGroups.length > 0);
const hasAnyContent = $derived(hasThinking || hasMessageContent);
/** Show thinking block only while there is no assistant message content yet; hide once reply text starts. */
const showThinkingBlock = $derived(hasThinking && !hasMessageContent);

/** "Thinking" while streaming, "Thought" or "Thought for Xs" when duration available */
const thinkingHeaderLabel = $derived.by(() => {
	if (isStreaming) return m.tool_thinking_streaming();
	const ms = message.thinkingDurationMs;
	if (ms != null && ms >= 0) {
		const s = Math.round(ms / 1000);
		return m.tool_thinking_done_duration({ seconds: String(s <= 1 ? 1 : s) });
	}
	return m.tool_thinking_done();
});

let thinkingContainerRef = $state<HTMLDivElement | undefined>();
let thinkingContentRef = $state<HTMLDivElement | undefined>();
let thinkingScrollRafId: number | null = null;

function cancelThinkingFollowFrame(): void {
	if (thinkingScrollRafId !== null) {
		cancelAnimationFrame(thinkingScrollRafId);
		thinkingScrollRafId = null;
	}
}

function scrollThinkingToBottom(container: HTMLDivElement): void {
	const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
	if (maxScrollTop <= 0) {
		return;
	}

	if (container.scrollTop >= maxScrollTop - 1) {
		return;
	}

	container.scrollTop = container.scrollHeight;
}

function scheduleThinkingFollow(container: HTMLDivElement): void {
	if (thinkingScrollRafId !== null) {
		return;
	}

	thinkingScrollRafId = requestAnimationFrame(() => {
		thinkingScrollRafId = null;

		if (!showThinkingBlock || !isStreaming || isCollapsed) {
			return;
		}

		if (thinkingContainerRef !== container) {
			return;
		}

		scrollThinkingToBottom(container);
	});
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
		scheduleThinkingFollow(thinkingContainerRef);
	}
});

$effect(() => {
	if (!showThinkingBlock || !isStreaming || isCollapsed || !thinkingContainerRef) {
		return;
	}

	const container = thinkingContainerRef;
	const content = thinkingContentRef;
	scheduleThinkingFollow(container);

	if (!content || typeof ResizeObserver !== "function") {
		return;
	}

	const observer = new ResizeObserver(() => {
		scheduleThinkingFollow(container);
	});

	observer.observe(content);

	return () => {
		observer.disconnect();
		cancelThinkingFollowFrame();
	};
});

$effect(() => {
	return () => {
		cancelThinkingFollowFrame();
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
					showHeader={!isStreaming}
					status={isStreaming ? "running" : "done"}
					collapsed={isCollapsed}
					onCollapseChange={(next: boolean) => {
						isCollapsed = next;
					}}
				>
					<div
						class="thinking-content scrollbar-none max-h-[5.04rem] overflow-y-auto opacity-60"
						bind:this={thinkingContainerRef}
					>
						<div bind:this={thinkingContentRef}>
							{#each filteredThoughtGroups as group, index (index)}
								{@const isLastThoughtGroup = index === filteredThoughtGroups.length - 1}
								{#if group.type === "text"}
									<ContentBlockRouter
										block={{ type: "text", text: group.text }}
										isStreaming={isStreaming && isLastThoughtGroup}
										{projectPath}
									/>
								{:else}
									<ContentBlockRouter block={group.block} {projectPath} />
								{/if}
							{/each}
						</div>
					</div>
				</AgentToolThinking>
			{/if}

			{#each groupedChunks.messageGroups as group, index (index)}
				{@const isLastGroup = index === groupedChunks.messageGroups.length - 1}
				<div class="space-y-1.5">
					{#if group.type === "text"}
						<ContentBlockRouter
							block={{ type: "text", text: group.text }}
							isStreaming={isStreaming && isLastGroup}
							{projectPath}
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
	.thinking-content,
	.thinking-content :global(.markdown-content),
	.thinking-content :global(.markdown-content *) {
		font-size: 12px !important;
	}
</style>
