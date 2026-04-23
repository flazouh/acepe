<script lang="ts">
import { AgentPanelStatePanel, TextShimmer } from "@acepe/ui";
import { getInteractionStore } from "../../../store/interaction-store.svelte.js";
import { deriveLiveSessionWorkProjection } from "../../../store/live-session-work.js";
import { buildSessionOperationInteractionSnapshot } from "../../../store/operation-association.js";
import { getSessionStore } from "../../../store/session-store.svelte.js";
import type { TurnState } from "../../../store/types.js";
import { createLogger } from "../../../utils/logger.js";
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
	sessionEntries = [],
	sessionProjectPath,
	allProjects = [],
	scrollContainer = $bindable(null),
	scrollViewport = $bindable(null),
	isAtBottom = $bindable(true),
	isAtTop = $bindable(true),
	isStreaming: isStreamingBindable = $bindable(false),
	onProjectSelected = () => {},
	onRetryConnection,
	onCancelConnection,
	agentIconSrc = "",
	isFullscreen = false,
	availableAgents = [],
	effectiveTheme = "dark",
	modifiedFilesState = null,
	turnState: turnStateProp,
	isWaitingForResponse: isWaitingProp,
}: AgentPanelContentProps = $props();

const sessionStore = getSessionStore();
const interactionStore = getInteractionStore();
const operationStore = sessionStore.getOperationStore();
const logger = createLogger({
	id: "agent-panel-content-trace",
	name: "AgentPanelContentTrace",
});
let lastContentTraceSignature = $state<string | null>(null);

// Reference to virtualized list for scroll control
let virtualizedListRef: VirtualizedEntryList | null = $state(null);

// Prefer props when provided (controller pattern), fall back to store access
const runtimeState = $derived(
	isWaitingProp !== undefined
		? null
		: sessionId
			? sessionStore.getSessionRuntimeState(sessionId)
			: null
);
const hotState = $derived(
	turnStateProp !== undefined ? null : sessionId ? sessionStore.getHotState(sessionId) : null
);
const currentStreamingToolCall = $derived(
	isWaitingProp !== undefined || !sessionId
		? null
		: operationStore.getCurrentStreamingToolCall(sessionId)
);
const interactionSnapshot = $derived.by(() =>
	isWaitingProp !== undefined || !sessionId
		? {
				pendingQuestion: null,
				pendingQuestionOperation: null,
				pendingPermission: null,
				pendingPermissionOperation: null,
				pendingPlanApproval: null,
				pendingPlanApprovalOperation: null,
			}
		: buildSessionOperationInteractionSnapshot(sessionId, operationStore, interactionStore)
);
const sessionWorkProjection = $derived.by(() => {
	if (isWaitingProp !== undefined || !sessionId) {
		return null;
	}

	return deriveLiveSessionWorkProjection({
		runtimeState,
		hotState: {
			status: hotState?.status ?? "idle",
			currentMode: hotState?.currentMode ?? null,
			connectionError: hotState?.connectionError ?? null,
			activeTurnFailure: hotState?.activeTurnFailure ?? null,
		},
		currentStreamingToolCall,
		interactionSnapshot: {
			pendingQuestion: interactionSnapshot.pendingQuestion,
			pendingPlanApproval: interactionSnapshot.pendingPlanApproval,
			pendingPermission: interactionSnapshot.pendingPermission,
		},
		hasUnseenCompletion: false,
	});
});

const turnState = $derived<TurnState>(turnStateProp ?? hotState?.turnState ?? "idle");
const isStreaming = $derived(turnState === "streaming");
const isWaitingForResponse = $derived(
	isWaitingProp ?? (sessionWorkProjection?.canonicalActivity === "awaiting_model")
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
	<AgentPanelStatePanel class="overflow-y-auto" centerContent={true}>
		{#snippet children()}
			<ProjectSelectionPanel
				projects={[...allProjects]}
				preSelectedProjectPath={sessionProjectPath}
				{onProjectSelected}
			/>
		{/snippet}
	</AgentPanelStatePanel>
{:else if viewState.kind === "error"}
	<AgentPanelStatePanel centerContent={true}>
		{#snippet children()}
			<ReadyToAssistPlaceholder {agentIconSrc} {isFullscreen} />
		{/snippet}
	</AgentPanelStatePanel>
{:else if viewState.kind === "conversation"}
	<div class="h-full flex flex-col relative">
		<div class="flex-1 min-h-0">
			{#if sessionId}
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
							<TextShimmer>{"Planning next moves"}</TextShimmer>
						</div>
					</MessageWrapper>
				</div>
			{/if}
		</div>
	</div>
{:else if viewState.kind === "ready"}
	<AgentPanelStatePanel centerContent={true}>
		{#snippet children()}
			<ReadyToAssistPlaceholder {agentIconSrc} {isFullscreen} />
		{/snippet}
	</AgentPanelStatePanel>
{/if}
