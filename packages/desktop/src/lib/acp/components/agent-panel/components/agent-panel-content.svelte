<script lang="ts">
import { TextShimmer } from "@acepe/ui";
import * as m from "$lib/paraglide/messages.js";
import { getSessionStore } from "../../../store/session-store.svelte.js";
import type { TurnState } from "../../../store/types.js";
import { createLogger } from "../../../utils/logger.js";
import ErrorMessage from "../../messages/error-message.svelte";
import MessageWrapper from "../../messages/message-wrapper.svelte";
import UserMessage from "../../messages/user-message.svelte";
import ProjectSelectionPanel from "../../project-selection-panel.svelte";
import ReadyToAssistPlaceholder from "../../ready-to-assist-placeholder.svelte";
import type { AgentPanelContentProps } from "../types/agent-panel-content-props.js";
import VirtualizedEntryList from "./virtualized-entry-list.svelte";

let {
	panelId,
	viewState,
	sessionId,
	sessionEntries,
	sessionProjectPath,
	allProjects,
	scrollContainer = $bindable(null),
	scrollViewport = $bindable(null),
	isAtBottom = $bindable(true),
	isAtTop = $bindable(true),
	isStreaming: isStreamingBindable = $bindable(false),
	onProjectAgentSelected,
	onRetryConnection,
	onCancelConnection,
	agentIconSrc,
	isFullscreen = false,
	availableAgents,
	effectiveTheme,
	modifiedFilesState,
}: AgentPanelContentProps = $props();

const sessionStore = getSessionStore();
const logger = createLogger({
	id: "agent-panel-content-trace",
	name: "AgentPanelContentTrace",
});
let lastContentTraceSignature = $state<string | null>(null);

// Reference to virtualized list for scroll control
let virtualizedListRef: VirtualizedEntryList | null = $state(null);

// Track hot state to ensure reactivity for UI state derivation
const runtimeState = $derived(sessionId ? sessionStore.getSessionRuntimeState(sessionId) : null);
const hotState = $derived(sessionId ? sessionStore.getHotState(sessionId) : null);

// Turn state from hot state - used for tool call status determination
const turnState = $derived<TurnState>(hotState?.turnState ?? "idle");

// Streaming state (derived from turnState for backward compatibility)
const isStreaming = $derived(turnState === "streaming");

const isWaitingForResponse = $derived(runtimeState?.showThinking ?? false);

const errorMessage = $derived(
	viewState.kind === "conversation" && viewState.errorDetails
		? { content: viewState.errorDetails }
		: null
);

// Sync streaming state to bindable prop for parent component
$effect(() => {
	isStreamingBindable = isStreaming;
});

$effect(() => {
	if (!import.meta.env.DEV) return;
	const signature = JSON.stringify({
		panelId,
		sessionId,
		viewState: viewState.kind,
		entryCount: sessionEntries.length,
		latestEntryId: sessionEntries.at(-1)?.id ?? null,
		latestEntryType: sessionEntries.at(-1)?.type ?? null,
		turnState,
		isWaitingForResponse,
	});
	if (signature === lastContentTraceSignature) {
		return;
	}
	lastContentTraceSignature = signature;
	logger.info("agent panel content props changed", JSON.parse(signature) as object);
});

// Note: isAtBottom is now updated via onNearBottomChange callback from VirtualizedEntryList
// This provides reactive updates on every scroll, not just on mount

// ===== PUBLIC API =====
export function scrollToBottom(options?: { force?: boolean }) {
	virtualizedListRef?.scrollToBottom(options);
}

export function prepareForNextUserReveal(options?: { force?: boolean }) {
	logger.info("prepareForNextUserReveal: content", {
		panelId,
		sessionId,
		entryCount: sessionEntries.length,
		latestEntryId: sessionEntries.at(-1)?.id ?? null,
		latestEntryType: sessionEntries.at(-1)?.type ?? null,
		force: options?.force ?? false,
	});
	virtualizedListRef?.prepareForNextUserReveal(options);
}

export function scrollToTop() {
	virtualizedListRef?.scrollToTop();
}
</script>

{#if viewState.kind === "project_selection"}
	<ProjectSelectionPanel
		projects={[...allProjects]}
		preSelectedProjectPath={sessionProjectPath}
		{availableAgents}
		{effectiveTheme}
		{onProjectAgentSelected}
	/>
{:else if viewState.kind === "error"}
	<ReadyToAssistPlaceholder {agentIconSrc} {isFullscreen} />
{:else if viewState.kind === "conversation"}
	<div class="h-full flex flex-col relative">
		<div class="flex-1 min-h-0">
			{#if errorMessage}
				<div class="px-3 pt-3 {isFullscreen ? 'flex justify-center' : ''}">
					<div class={isFullscreen ? "w-full max-w-4xl" : ""}>
						<ErrorMessage message={errorMessage} />
					</div>
				</div>
			{/if}
			{#if sessionId}
				{#key sessionId}
					<VirtualizedEntryList
						bind:this={virtualizedListRef}
						{panelId}
						entries={sessionEntries}
						{sessionId}
						{turnState}
						{isWaitingForResponse}
						projectPath={sessionProjectPath ?? undefined}
						{isFullscreen}
						{modifiedFilesState}
						onNearBottomChange={(nearBottom) => (isAtBottom = nearBottom)}
						onNearTopChange={(nearTop) => (isAtTop = nearTop)}
					/>
				{/key}
			{:else if sessionEntries.length > 0}
				<!-- Pending entry: session not yet created, show optimistic user message + thinking shimmer -->
				<div class="h-full overflow-y-auto px-1">
					{#each sessionEntries as entry (entry.id)}
						{#if entry.type === "user"}
							<MessageWrapper entryIndex={0} entryKey={entry.id} {isFullscreen}>
								<UserMessage message={entry.message} />
							</MessageWrapper>
						{/if}
					{/each}
					<MessageWrapper entryIndex={sessionEntries.length} entryKey="pending-thinking" {isFullscreen}>
						<div class="py-3 text-sm text-muted-foreground">
							<TextShimmer>{m.waiting_planning_next_moves()}</TextShimmer>
						</div>
					</MessageWrapper>
				</div>
			{/if}
		</div>
	</div>
{:else if viewState.kind === "ready"}
	<ReadyToAssistPlaceholder {agentIconSrc} {isFullscreen} />
{/if}
