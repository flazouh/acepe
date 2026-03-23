<script lang="ts">
import { onMount, tick } from "svelte";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import * as m from "$lib/paraglide/messages.js";
import type { SessionEntry } from "../application/dto/session-entry.js";
import type { SessionStatus } from "../application/dto/session-status.js";
import type { TaskProgress } from "../application/dto/task-progress.js";
import { getSessionStore } from "../store/index.js";
import PlanView from "./plan-view.svelte";
import VirtualSessionList from "./virtual-session-list.svelte";

/**
 * Narrowed session data for session view.
 * Only includes fields actually used by this component.
 */
interface SessionViewData {
	readonly entries: ReadonlyArray<SessionEntry>;
	readonly isStreaming: boolean;
	readonly status: SessionStatus;
	readonly taskProgress: TaskProgress | null;
}

let {
	session,
	isLoading = false,
	isResizing = false,
}: {
	session: SessionViewData | null;
	isLoading?: boolean;
	isResizing?: boolean;
} = $props();

// Get the session store
const sessionStore = getSessionStore();

// Virtual list reference
let virtualListRef: VirtualSessionList | null = $state(null);

// Near-bottom detection for smart auto-scroll
const SCROLL_THRESHOLD = 150; // pixels from bottom considered "at bottom"
let isNearBottom = true; // Track if user is near bottom (not reactive to avoid loops)
let lastScrolledEntryCount = 0; // Track last count we scrolled for

// Track user scroll position to detect intent (adapted for virtual list)
function handleVirtualScroll(offset: number) {
	if (!virtualListRef) return;

	const totalHeight = virtualListRef.getScrollSize();
	const viewportHeight = virtualListRef.getViewportSize();
	const distanceFromBottom = totalHeight - (offset + viewportHeight);

	// Update near-bottom state (non-reactive)
	isNearBottom = distanceFromBottom < SCROLL_THRESHOLD;
}

// Scroll to bottom using virtual list API
function scrollToBottom() {
	virtualListRef?.scrollToBottom();
}

// Scroll to bottom on mount
onMount(() => {
	tick().then(() => {
		scrollToBottom();
		lastScrolledEntryCount = session?.entries?.length ?? 0;
	});
});

// Derived entry count for reactivity
const entryCount = $derived(session?.entries?.length ?? 0);

// Auto-scroll effect: scroll when new entries arrive and user is near bottom
$effect(() => {
	if (entryCount > lastScrolledEntryCount && isNearBottom) {
		lastScrolledEntryCount = entryCount;
		scrollToBottom();
	}
});
</script>

<div class="flex flex-col h-full min-h-0 overflow-hidden">
	{#if !session}
		<!-- No session - show loading or empty state -->
		{#if sessionStore.loading || isLoading}
			<div class="flex items-center justify-center flex-1">
				<Spinner class="h-6 w-6" />
			</div>
		{/if}
	{:else if isResizing}
		<!-- Show edit tool UI sample while resizing -->
		<div class="flex items-center justify-center flex-1 min-h-0 p-8">
			<div class="w-full max-w-2xl">
				<!-- Edit Tool Card -->
				<div class="border border-border rounded-md bg-input/30 overflow-hidden">
					<!-- Header -->
					<div class="flex items-center gap-2 text-xs px-2 py-2 border-b border-border bg-muted/20">
						<div class="flex items-center gap-1.5 flex-1">
							<svg class="h-3 w-3 text-muted-foreground" viewBox="0 0 16 16" fill="currentColor">
								<rect x="2" y="1.75" width="12.5" height="8.5" rx="0.75" ry="0.75" />
							</svg>
							<span class="text-foreground/80 font-medium">utils.ts</span>
						</div>
						<span class="text-green-500">+5</span>
						<span class="text-red-500">-2</span>
					</div>

					<!-- Diff View -->
					<div class="font-mono text-xs bg-background/50 overflow-hidden">
						<!-- Added lines -->
						<div class="flex border-l-2 border-l-green-500 bg-green-500/10">
							<div
								class="text-muted-foreground text-right w-10 px-2 py-1 select-none border-r border-border/50"
							>
								1
							</div>
							<div class="flex-1 px-2 py-1 text-foreground/80">
								+ function addNumbers(a: number, b:
							</div>
						</div>
						<div class="flex border-l-2 border-l-green-500 bg-green-500/10">
							<div
								class="text-muted-foreground text-right w-10 px-2 py-1 select-none border-r border-border/50"
							>
								2
							</div>
							<div class="flex-1 px-2 py-1 text-foreground/80">+ number): number &#123;</div>
						</div>
						<div class="flex border-l-2 border-l-green-500 bg-green-500/10">
							<div
								class="text-muted-foreground text-right w-10 px-2 py-1 select-none border-r border-border/50"
							>
								3
							</div>
							<div class="flex-1 px-2 py-1 text-foreground/80">+ return a + b;</div>
						</div>

						<!-- Removed lines -->
						<div class="flex border-l-2 border-l-red-500 bg-red-500/10">
							<div
								class="text-muted-foreground text-right w-10 px-2 py-1 select-none border-r border-border/50"
							>
								4
							</div>
							<div class="flex-1 px-2 py-1 text-foreground/80">- function add(x, y) &#123;</div>
						</div>
						<div class="flex border-l-2 border-l-red-500 bg-red-500/10">
							<div
								class="text-muted-foreground text-right w-10 px-2 py-1 select-none border-r border-border/50"
							>
								5
							</div>
							<div class="flex-1 px-2 py-1 text-foreground/80">- return x + y</div>
						</div>

						<!-- Context line -->
						<div class="flex border-l-2 border-l-transparent">
							<div
								class="text-muted-foreground text-right w-10 px-2 py-1 select-none border-r border-border/50"
							>
								6
							</div>
							<div class="flex-1 px-2 py-1 text-foreground/60">&#125;</div>
						</div>
					</div>

					<!-- Footer - Collapse toggle -->
					<div
						class="flex items-center justify-center py-1 border-t border-border hover:bg-muted/50 transition-colors cursor-pointer bg-muted/20"
					>
						<svg
							class="h-3 w-3 text-muted-foreground"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
						>
							<path
								d="M11 6L8 9 5 6"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</div>
				</div>

				<p class="text-xs text-muted-foreground text-center mt-3">{m.thread_view_resizing()}</p>
			</div>
		</div>
	{:else}
		<div class="flex flex-col flex-1 min-h-0">
			<!-- Virtualized session entries -->
			<VirtualSessionList
				bind:this={virtualListRef}
				entries={session.entries}
				turnState={session.isStreaming ? "streaming" : "idle"}
				onscroll={handleVirtualScroll}
			/>

			<!-- Status indicators at the bottom (outside virtual list) -->
			{#if session.status === "connecting"}
				<div class="px-4 py-3 text-muted-foreground border-t border-border/50">
					<span class="text-sm">{m.thread_view_connecting()}</span>
				</div>
			{/if}

			{#if session.taskProgress}
				<div class="px-4 py-2 border-t border-border/50">
					<PlanView
						plan={{
							steps: session.taskProgress.steps.map((step) => ({
								description: step,
								status: "pending" as const,
							})),
						}}
					/>
				</div>
			{/if}
		</div>
	{/if}
</div>
