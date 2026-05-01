<script lang="ts">
import { createVirtualizer } from "@tanstack/svelte-virtual";
import { get } from "svelte/store";
import { getChatPreferencesStore } from "../store/chat-preferences-store.svelte.js";
import type { SessionEntry, TurnState } from "../store/types.js";
import type { AskMessage as AskMessageType } from "../types/ask-message.js";
import type { AssistantMessage as AssistantMessageType } from "../types/assistant-message.js";
import { DEFAULT_STREAMING_ANIMATION_MODE } from "../types/streaming-animation-mode.js";
import type { ToolCall } from "../types/tool-call.js";
import type { UserMessage as UserMessageType } from "../types/user-message.js";
import { AgentPanelConversationEntry } from "@acepe/ui";
import { AskMessage, AssistantMessage, UserMessage } from "./messages/index.js";
import { mapToolCallToSceneEntry } from "./agent-panel/scene/desktop-agent-panel-scene.js";
import { estimateSessionEntryHeight, SESSION_LIST_OVERSCAN } from "./virtualization-tuning.js";

interface Props {
	entries: ReadonlyArray<SessionEntry>;
	turnState?: TurnState;
	onscroll?: (offset: number) => void;
	projectPath?: string;
}

let { entries, turnState = "idle", onscroll, projectPath }: Props = $props();
let scrollElement = $state<HTMLDivElement | null>(null);
const chatPrefs = getChatPreferencesStore();
const streamingAnimationMode = $derived(
	chatPrefs?.streamingAnimationMode ?? DEFAULT_STREAMING_ANIMATION_MODE
);
const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
	count: 0,
	getScrollElement: () => scrollElement,
	estimateSize: () => 88,
	overscan: SESSION_LIST_OVERSCAN,
	getItemKey: (index) => index,
});

$effect(() => {
	const currentEntries = entries;
	get(virtualizer).setOptions({
		count: currentEntries.length,
		getItemKey: (index) => currentEntries[index]?.id ?? index,
		estimateSize: (index) => {
			const entry = currentEntries[index];
			return entry ? estimateSessionEntryHeight(entry) : 88;
		},
	});
});

$effect(() => {
	const viewport = scrollElement;
	if (!viewport) return;
	const sessionVirtualizer = get(virtualizer);
	const observer = new ResizeObserver(() => {
		sessionVirtualizer.measure();
	});
	observer.observe(viewport);
	return () => {
		observer.disconnect();
	};
});

// Expose scroll methods for parent component
export function scrollToBottom() {
	if (entries.length > 0) {
		get(virtualizer).scrollToIndex(entries.length - 1, { align: "end" });
	}
}

export function scrollToTop() {
	get(virtualizer).scrollToOffset(0);
}

export function getScrollOffset(): number {
	return get(virtualizer).scrollOffset ?? 0;
}

export function getScrollSize(): number {
	return get(virtualizer).getTotalSize();
}

export function getViewportSize(): number {
	return get(virtualizer).scrollRect?.height ?? 0;
}

function handleScroll(): void {
	onscroll?.(scrollElement?.scrollTop ?? 0);
}

function measureSessionRow(node: HTMLDivElement): { destroy: () => void } {
	const sessionVirtualizer = get(virtualizer);
	sessionVirtualizer.measureElement(node);
	const observer = new ResizeObserver(() => {
		sessionVirtualizer.measureElement(node);
		sessionVirtualizer.measure();
	});
	observer.observe(node);
	return {
		destroy() {
			observer.disconnect();
		},
	};
}
</script>

<div
	bind:this={scrollElement}
	class="flex-1 h-full overflow-auto"
	style="background: var(--background);"
	onscroll={handleScroll}
>
	<div style={`height: ${$virtualizer.getTotalSize()}px; position: relative; width: 100%;`}>
		{#each $virtualizer.getVirtualItems() as virtualItem (virtualItem.key)}
			{@const entry = entries[virtualItem.index]}
			{#if entry}
				<div
					use:measureSessionRow
					data-index={virtualItem.index}
					style={`position: absolute; top: 0; left: 0; width: 100%; transform: translateY(${virtualItem.start}px);`}
				>
					<div class="px-4 py-2">
						{#if entry.type === "user"}
							<UserMessage message={entry.message as UserMessageType} />
						{:else if entry.type === "assistant"}
							<AssistantMessage
								message={entry.message as AssistantMessageType}
								revealMessageKey={entry.id}
								{projectPath}
								{streamingAnimationMode}
							/>
						{:else if entry.type === "ask"}
							<AskMessage message={entry.message as AskMessageType} />
						{:else if entry.type === "tool_call"}
						{@const sceneEntry = mapToolCallToSceneEntry(entry.message as ToolCall, turnState, false, null)}
						<AgentPanelConversationEntry entry={sceneEntry} iconBasePath="/svgs/icons" />
						{/if}
					</div>
				</div>
			{/if}
		{/each}
	</div>
</div>
