<script lang="ts">
import { AgentPanelConversationEntry } from "@acepe/ui/agent-panel";
import { setIconConfig } from "@acepe/ui/icon-context";
import type {
	AgentPanelPlanActionEvent,
	AgentPanelPlanViewEvent,
	AgentPanelQuestionSelectEvent,
	AgentPanelSceneEntryModel,
	AgentToolFileSelectEvent,
	AgentToolStatus,
	AssistantRenderBlockContext,
} from "@acepe/ui/agent-panel";
import { setContext } from "svelte";
import { SESSION_CONTEXT_KEY_EXPORT } from "../../../hooks/use-session-context.js";
import type { BufferProjection } from "../../../store/transcript-viewport-store.svelte.js";
import type { TurnState } from "../../../store/types.js";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import type {
	OperationState,
	SessionStateEnvelope,
	TranscriptSegment,
	TranscriptViewportRow,
} from "../../../../services/acp-types.js";
import { getChatPreferencesStore } from "../../../store/chat-preferences-store.svelte.js";
import { getPermissionStore } from "../../../store/permission-store.svelte.js";
import { getSessionStore } from "../../../store/session-store.svelte.js";
import { ViewportSessionNotAttachedAcpError } from "../../../errors/acp-error.js";
import { DEFAULT_STREAMING_ANIMATION_MODE } from "../../../types/streaming-animation-mode.js";
import { getWorkerPool } from "../../../utils/worker-pool-singleton.js";
import {
	pierreDiffsUnsafeCSS,
	registerCursorThemeForPierreDiffs,
} from "../../../utils/pierre-diffs-theme.js";
import ContentBlockRouter from "../../messages/content-block-router.svelte";
import MessageWrapper from "../../messages/message-wrapper.svelte";
import PermissionBar from "../../tool-calls/permission-bar.svelte";
import {
	confirmTranscriptViewportHeight,
	revealTranscriptViewportRow,
	resizeTranscriptViewport,
	scrollTranscriptViewport,
} from "../../../session-state/session-state-viewport-command-service.js";
import { useTheme } from "../../../../components/theme/context.svelte.js";
import { tick } from "svelte";

const NEAR_EDGE_THRESHOLD_PX = 24;
// Refill when the visible range comes within roughly one screen of a buffered
// edge that is not also the layout extreme, so a fresh slice lands before the
// user scrolls into unbuffered space.
const REFILL_THRESHOLD_PX = 800;
const EMPTY_SCENE_ENTRIES: readonly AgentPanelSceneEntryModel[] = [];

type SceneContentViewportProps = {
	panelId: string;
	sceneEntries?: readonly AgentPanelSceneEntryModel[];
	bufferProjection?: BufferProjection | null;
	turnState: TurnState;
	isWaitingForResponse: boolean;
	waitingLabel?: string | null;
	projectPath: string | undefined;
	sessionId: string | null;
	pendingUserRevealRequestKey?: string | null;
	isFullscreen?: boolean;
	modifiedFilesState?: ModifiedFilesState | null;
	onNearBottomChange?: (isNearBottom: boolean) => void;
	onNearTopChange?: (isNearTop: boolean) => void;
	onQuestionSelect?: (event: AgentPanelQuestionSelectEvent) => void;
	onPlanBuild?: (event: AgentPanelPlanActionEvent) => void;
	onPlanCancel?: (event: AgentPanelPlanActionEvent) => void;
	onPlanViewFull?: (event: AgentPanelPlanViewEvent) => void;
	onToolFileSelect?: (event: AgentToolFileSelectEvent) => void;
	isPlanActionAvailable?: (event: AgentPanelPlanActionEvent) => boolean;
};

const permissionStore = getPermissionStore();
const sessionStore = getSessionStore();

let {
	panelId,
	sceneEntries,
	bufferProjection = null,
	turnState,
	isWaitingForResponse: _isWaitingForResponse,
	waitingLabel: _waitingLabel = null,
	projectPath,
	sessionId,
	pendingUserRevealRequestKey = null,
	isFullscreen = false,
	modifiedFilesState = null,
	onNearBottomChange,
	onNearTopChange,
	onQuestionSelect,
	onPlanBuild,
	onPlanCancel,
	onPlanViewFull,
	onToolFileSelect,
	isPlanActionAvailable,
}: SceneContentViewportProps = $props();

const chatPrefs = getChatPreferencesStore();
const themeState = useTheme();
const streamingAnimationMode = $derived(
	chatPrefs?.streamingAnimationMode ?? DEFAULT_STREAMING_ANIMATION_MODE
);
const editToolTheme = $derived({
	theme: themeState.effectiveTheme,
	themeNames: { dark: "Cursor Dark", light: "pierre-light" },
	workerPool: getWorkerPool(),
	onBeforeRender: registerCursorThemeForPierreDiffs,
	unsafeCSS: pierreDiffsUnsafeCSS,
});

setIconConfig({ basePath: "/svgs/icons" });
setContext(SESSION_CONTEXT_KEY_EXPORT, {
	get sessionId() {
		return sessionId ?? undefined;
	},
	get panelId() {
		return panelId;
	},
	get projectPath() {
		return projectPath;
	},
	get turnState() {
		return turnState;
	},
	get modifiedFilesState() {
		return modifiedFilesState ?? undefined;
	},
});

let viewportRef: HTMLDivElement | null = $state(null);
let scrollContainerRef: HTMLDivElement | null = $state(null);
let lastViewportHeightPx = $state(720);
let pendingViewportHeightPx = $state<number | null>(null);
let consumedPendingUserRevealRequestKey = $state<string | null>(null);
let bootstrappedSessionId: string | null = null;
let lastAppliedScrollEmissionSeq = -1;
let lastAppliedCorrectionEmissionSeq = -1;
let lastFollowTailTotalHeightPx = -1;
let suppressNextScrollIntent = false;
let scrollIntentRafPending = false;

const sceneEntryById = $derived.by(() => {
	const index = new Map<string, AgentPanelSceneEntryModel>();
	for (const entry of sceneEntries ?? EMPTY_SCENE_ENTRIES) {
		index.set(entry.id, entry);
	}
	return index;
});

const bufferRows = $derived(bufferProjection?.rows ?? []);
const renderedRows = $derived.by(() => {
	const startIndex = bufferProjection?.bufferStartIndex ?? 0;
	const offsets = bufferProjection?.offsetsPx ?? [];
	return bufferRows.map((row, index) => {
		return {
			row,
			index: startIndex + index,
			offsetPx: offsets[index] ?? 0,
			entry: resolveSceneEntry(row),
		};
	});
});

const totalHeightPx = $derived(bufferProjection?.totalHeightPx ?? 0);

// Anchor for the flow-layout window: the canonical top of the first buffered
// row. Rows below it flow naturally (block/flex column) so intra-window layout
// can never overlap or gap regardless of estimate-vs-actual height drift.
// Canonical offsets still own the scrollbar (totalHeightPx) and refill math.
const windowTopPx = $derived(renderedRows[0]?.offsetPx ?? 0);

function segmentText(segments: readonly TranscriptSegment[]): string {
	let text = "";
	for (const segment of segments) {
		text += segment.text;
	}
	return text;
}

function resolveSceneEntry(row: TranscriptViewportRow): AgentPanelSceneEntryModel {
	const canonicalEntry = sceneEntryById.get(row.sourceEntryId);
	if (canonicalEntry !== undefined) {
		return canonicalEntry;
	}

	if (row.content.kind === "transcript" && row.content.role === "user") {
		return {
			id: row.sourceEntryId,
			type: "user",
			text: segmentText(row.content.segments),
		};
	}

	if (row.content.kind === "transcript" && row.content.role === "assistant") {
		return {
			id: row.sourceEntryId,
			type: "assistant",
			markdown: segmentText(row.content.segments.filter((segment) => segment.kind === "text")),
			message: {
				chunks: row.content.segments.map((segment) => {
					return {
						type: segment.kind === "thought" ? "thought" : "message",
						block: {
							type: "text",
							text: segment.text,
						},
					};
				}),
			},
			isStreaming: row.activeStreamingTail !== null,
		};
	}

	const operation = row.operationLinks[0];
	return {
		id: row.sourceEntryId,
		type: "tool_call",
		toolCallId: operation?.toolCallId,
		operationId: operation?.operationId,
		kind: "other",
		title: operation?.name ?? (row.kind === "error" ? "Error" : "Tool"),
		status: operation === undefined ? "degraded" : toolStatusFromOperationState(operation.state),
		presentationState: operation === undefined ? "degraded_operation" : "resolved",
		degradedReason: operation === undefined ? "Viewport row has no linked operation." : null,
		resultText: row.content.kind === "transcript" ? segmentText(row.content.segments) : null,
	};
}

function toolStatusFromOperationState(state: OperationState): AgentToolStatus {
	if (state === "running") {
		return "running";
	}
	if (state === "completed") {
		return "done";
	}
	if (state === "failed") {
		return "error";
	}
	if (state === "blocked") {
		return "blocked";
	}
	if (state === "cancelled") {
		return "cancelled";
	}
	if (state === "degraded") {
		return "degraded";
	}
	return "pending";
}

function revisionInput() {
	return bufferProjection?.revision ?? null;
}

function applyEnvelope(envelope: SessionStateEnvelope | null): void {
	if (sessionId === null || envelope === null) {
		return;
	}
	// Suppress late command-response payloads while a recovery episode is in
	// flight. The reset projection would otherwise accept this stale payload
	// (current === null) and undo the reattach. Event-stream payloads flow
	// through a separate path (live consumer -> applyBufferPush/Delta) and are
	// still accepted during recovery.
	if (sessionStore.getViewportAttachmentStatus(sessionId) !== "attached") {
		return;
	}
	sessionStore.applySessionStateEnvelope(sessionId, envelope);
}

function extractViewportSessionNotAttached(
	error: unknown
): ViewportSessionNotAttachedAcpError | null {
	if (error instanceof ViewportSessionNotAttachedAcpError) {
		return error;
	}
	if (
		error !== null &&
		typeof error === "object" &&
		"cause" in error &&
		error.cause instanceof ViewportSessionNotAttachedAcpError
	) {
		return error.cause;
	}
	return null;
}

function handleDispatchError(error: unknown): void {
	const notAttached = extractViewportSessionNotAttached(error);
	if (notAttached !== null) {
		sessionStore.recoverViewportAttachment(notAttached.sessionId);
	}
}

function isDispatchSuppressed(): boolean {
	return sessionId !== null && sessionStore.getViewportAttachmentStatus(sessionId) !== "attached";
}

function dispatchScrollIntent(offsetPx: number): void {
	const revision = revisionInput();
	if (sessionId === null || revision === null || isDispatchSuppressed()) {
		return;
	}
	scrollTranscriptViewport({
		sessionId,
		revision,
		viewportHeightPx: lastViewportHeightPx,
		offsetPx,
	}).match(applyEnvelope, handleDispatchError);
}

function dispatchRevealIntent(rowId: string | null): void {
	const revision = revisionInput();
	if (sessionId === null || revision === null || isDispatchSuppressed()) {
		return;
	}
	revealTranscriptViewportRow({
		sessionId,
		revision,
		viewportHeightPx: lastViewportHeightPx,
		rowId,
	}).match(applyEnvelope, handleDispatchError);
}

function dispatchResizeIntent(heightPx: number): void {
	const revision = revisionInput();
	if (sessionId === null || revision === null || isDispatchSuppressed()) {
		pendingViewportHeightPx = heightPx;
		return;
	}
	resizeTranscriptViewport({
		sessionId,
		revision,
		viewportHeightPx: heightPx,
	}).match(applyEnvelope, handleDispatchError);
}

function dispatchHeightConfirmation(row: TranscriptViewportRow, heightPx: number): void {
	const revision = revisionInput();
	if (sessionId === null || revision === null || isDispatchSuppressed()) {
		return;
	}
	confirmTranscriptViewportHeight({
		sessionId,
		revision,
		viewportHeightPx: lastViewportHeightPx,
		rowId: row.rowId,
		rowVersion: row.version,
		heightPx,
	}).match(applyEnvelope, handleDispatchError);
}

function handleScroll(event: Event): void {
	if (!(event.currentTarget instanceof HTMLDivElement)) {
		return;
	}
	const offsetPx = event.currentTarget.scrollTop;
	updateEdgeFlags(offsetPx);
	if (suppressNextScrollIntent) {
		suppressNextScrollIntent = false;
		return;
	}
	if (scrollIntentRafPending) {
		return;
	}
	scrollIntentRafPending = true;
	requestAnimationFrame(() => {
		scrollIntentRafPending = false;
		if (scrollContainerRef === null || sessionId === null) {
			return;
		}
		const scrollTopPx = Math.max(0, Math.round(scrollContainerRef.scrollTop));
		// Native scroll already moved the buffered rows under the viewport at no
		// JS cost. Only round-trip to Rust when the visible range is leaving the
		// buffered span (jump scroll) or approaching a non-extreme edge (refill).
		const outside = sessionStore.viewportIsOutsideBuffer(
			sessionId,
			scrollTopPx,
			lastViewportHeightPx
		);
		const needsRefill = sessionStore.viewportNeedsRefill(
			sessionId,
			scrollTopPx,
			lastViewportHeightPx,
			REFILL_THRESHOLD_PX
		);
		if (outside || needsRefill) {
			dispatchScrollIntent(scrollTopPx);
		}
	});
}

function updateEdgeFlags(scrollTopPx: number): void {
	if (bufferProjection === null) {
		return;
	}
	const atLayoutTop =
		bufferProjection.bufferStartIndex === 0 && scrollTopPx <= NEAR_EDGE_THRESHOLD_PX;
	onNearTopChange?.(atLayoutTop);
	const atLayoutBottom =
		bufferProjection.bufferEndIndex >= bufferProjection.layoutRowCount &&
		totalHeightPx - lastViewportHeightPx - scrollTopPx <= NEAR_EDGE_THRESHOLD_PX;
	onNearBottomChange?.(atLayoutBottom || bufferProjection.mode.kind === "followingTail");
}

function observeViewport(node: HTMLDivElement): { destroy: () => void } {
	const observer = new ResizeObserver((entries) => {
		const entry = entries[0];
		if (entry === undefined) {
			return;
		}
		const heightPx = Math.max(0, Math.round(entry.contentRect.height));
		if (heightPx === lastViewportHeightPx) {
			return;
		}
		lastViewportHeightPx = heightPx;
		dispatchResizeIntent(heightPx);
	});
	observer.observe(node);
	return {
		destroy() {
			observer.disconnect();
		},
	};
}

function confirmRowHeight(node: HTMLDivElement, row: TranscriptViewportRow): { update: (nextRow: TranscriptViewportRow) => void; destroy: () => void } {
	let currentRow = row;
	let lastHeightPx = 0;
	const observer = new ResizeObserver((entries) => {
		const entry = entries[0];
		if (entry === undefined) {
			return;
		}
		const heightPx = Math.max(0, Math.round(entry.contentRect.height));
		if (heightPx === lastHeightPx) {
			return;
		}
		lastHeightPx = heightPx;
		dispatchHeightConfirmation(currentRow, heightPx);
	});
	observer.observe(node);
	return {
		update(nextRow) {
			currentRow = nextRow;
			lastHeightPx = 0;
		},
		destroy() {
			observer.disconnect();
		},
	};
}

function latestVisibleUserRowId(): string | null {
	for (let index = bufferRows.length - 1; index >= 0; index -= 1) {
		const row = bufferRows[index];
		if (row?.kind === "user") {
			return row.rowId;
		}
	}
	return null;
}

// Bootstrap the buffer once per session: the live producer pushes the initial
// buffer on the open event stream, but a forced request guards a mount that
// races ahead of that push. Idempotent in the store (no-op if a buffer exists).
$effect(() => {
	if (sessionId === null || sessionId === bootstrappedSessionId) {
		return;
	}
	bootstrappedSessionId = sessionId;
	sessionStore.ensureViewportBufferBootstrap(sessionId);
});

$effect(() => {
	if (bufferProjection === null || pendingViewportHeightPx === null) {
		return;
	}
	const heightPx = pendingViewportHeightPx;
	pendingViewportHeightPx = null;
	dispatchResizeIntent(heightPx);
});

// Apply a Rust-decided scroll position once per push that carries one (initial
// open, reveal, follow-tail). Keyed on emissionSeq so it fires exactly once per
// repositioning push and never fights native scrolling on plain refills.
$effect(() => {
	const projection = bufferProjection;
	if (scrollContainerRef === null || projection === null) {
		return;
	}
	const target = projection.scrollTopTarget;
	if (target === null || projection.emissionSeq === lastAppliedScrollEmissionSeq) {
		return;
	}
	lastAppliedScrollEmissionSeq = projection.emissionSeq;
	void tick().then(() => {
		if (scrollContainerRef === null) {
			return;
		}
		if (Math.abs(scrollContainerRef.scrollTop - target) <= 1) {
			return;
		}
		suppressNextScrollIntent = true;
		scrollContainerRef.scrollTop = target;
	});
});

// Apply the Rust-decided RELATIVE scroll correction additively to the live
// scrollTop. Unlike the absolute target above, this never fights the user's
// live position: when heights ABOVE the anchor change (off-screen confirmations,
// prepend-on-scroll-up) content shifts under the viewport, and the canonical
// Δ_above (`scrollAnchorCorrectionPx`) compensates it exactly. Keyed on
// emissionSeq so it drains the coalescing-safe accumulator once per emission
// window — the accumulator (store-owned) sums corrections across a burst that
// collapses into a single Svelte flush, so no intermediate Δ is lost. The
// suppress guard ensures the programmatic adjustment never echoes a
// (non-canonical) scroll intent back to Rust.
$effect(() => {
	const projection = bufferProjection;
	if (scrollContainerRef === null || projection === null || sessionId === null) {
		return;
	}
	if (projection.emissionSeq === lastAppliedCorrectionEmissionSeq) {
		return;
	}
	lastAppliedCorrectionEmissionSeq = projection.emissionSeq;
	const targetSessionId = sessionId;
	void tick().then(() => {
		if (scrollContainerRef === null) {
			return;
		}
		const correction = sessionStore.consumeViewportScrollCorrectionPx(targetSessionId);
		if (correction === 0) {
			return;
		}
		const current = scrollContainerRef.scrollTop;
		const maxTop = Math.max(0, scrollContainerRef.scrollHeight - scrollContainerRef.clientHeight);
		const next = Math.min(maxTop, Math.max(0, current + correction));
		if (Math.abs(next - current) <= 0.5) {
			return;
		}
		suppressNextScrollIntent = true;
		scrollContainerRef.scrollTop = next;
	});
});

// Following-tail pin as a LOCAL invariant: when canonical layout grows during
// streaming, re-pin to the bottom after the new rows have rendered. Re-asserted
// only when totalHeightPx changes while in followingTail mode.
$effect(() => {
	const projection = bufferProjection;
	if (scrollContainerRef === null || projection === null) {
		return;
	}
	if (projection.mode.kind !== "followingTail") {
		lastFollowTailTotalHeightPx = -1;
		return;
	}
	if (totalHeightPx === lastFollowTailTotalHeightPx) {
		return;
	}
	lastFollowTailTotalHeightPx = totalHeightPx;
	void tick().then(() => {
		if (scrollContainerRef === null) {
			return;
		}
		// Pin to the ACTUAL reachable bottom, not canonical `totalHeightPx - vh`.
		// With flow layout the buffered window's real height can exceed its
		// canonical span while heights are still converging; targeting the real
		// max scroll keeps the tail in view through that drift (self-heals as
		// confirmations land). Guarded by suppressNextScrollIntent so this
		// programmatic scroll never dispatches a (non-canonical) scroll intent.
		const target = Math.max(0, scrollContainerRef.scrollHeight - scrollContainerRef.clientHeight);
		if (Math.abs(scrollContainerRef.scrollTop - target) <= 1) {
			return;
		}
		suppressNextScrollIntent = true;
		scrollContainerRef.scrollTop = target;
	});
});

$effect(() => {
	if (pendingUserRevealRequestKey === null || pendingUserRevealRequestKey === consumedPendingUserRevealRequestKey) {
		return;
	}
	consumedPendingUserRevealRequestKey = pendingUserRevealRequestKey;
	dispatchRevealIntent(latestVisibleUserRowId());
});

export function scrollToBottom(_options?: { force?: boolean }) {
	dispatchRevealIntent(null);
}

export function prepareForNextUserReveal(_options?: { force?: boolean }) {
	dispatchRevealIntent(latestVisibleUserRowId());
}

export function scrollToTop() {
	dispatchScrollIntent(0);
}
</script>

<div bind:this={viewportRef} use:observeViewport class="h-full min-h-0">
	{#snippet renderAssistantBlock(context: AssistantRenderBlockContext)}
		{#if context.group.type === "text"}
			<ContentBlockRouter
				block={{ type: "text", text: context.group.text }}
				isStreaming={context.isStreaming}
				tokenRevealCss={context.tokenRevealCss}
				{projectPath}
				{streamingAnimationMode}
			/>
		{:else}
			<ContentBlockRouter block={context.group.block} {projectPath} />
		{/if}
	{/snippet}

	<div
		bind:this={scrollContainerRef}
		data-testid="rust-transcript-viewport"
		class="h-full min-h-0 overflow-y-auto"
		style="overflow-anchor: none;"
		onscroll={handleScroll}
	>
		<div style={`height: ${totalHeightPx}px; position: relative; width: 100%;`}>
			<div
				style={`position: absolute; left: 0; top: 0; width: 100%; transform: translateY(${windowTopPx}px); display: flex; flex-direction: column;`}
			>
				{#each renderedRows as rendered (rendered.row.rowId)}
					<div use:confirmRowHeight={rendered.row} data-entry-key={rendered.row.rowId}>
						<MessageWrapper
							entryIndex={rendered.index}
							entryKey={rendered.row.rowId}
							messageId={rendered.entry.type === "user" ? rendered.entry.id : undefined}
							observeRevealResize={false}
							{isFullscreen}
						>
							<AgentPanelConversationEntry
								entry={rendered.entry}
								iconBasePath="/svgs/icons"
								{editToolTheme}
								{projectPath}
								{streamingAnimationMode}
								renderAssistantBlock={renderAssistantBlock}
								{onQuestionSelect}
								{onPlanBuild}
								{onPlanCancel}
								{onPlanViewFull}
								{onToolFileSelect}
								{isPlanActionAvailable}
							/>
							{#if rendered.entry.type === "tool_call" && rendered.entry.toolCallId !== undefined && sessionId !== null}
								{@const attachedPermission = permissionStore.getForToolCall(sessionId, rendered.entry.toolCallId)}
								{#if attachedPermission !== undefined}
									<div class="tool-call-permission-row">
										<div class="tool-call-permission-attachment">
											<PermissionBar
												{sessionId}
												permission={attachedPermission}
												projectPath={projectPath ?? null}
												attachment="tool-call"
											/>
										</div>
									</div>
								{/if}
							{/if}
						</MessageWrapper>
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>

<style>
	.tool-call-permission-row {
		display: flex;
		position: relative;
		z-index: 1;
		margin-top: -1px;
		max-width: 100%;
		width: 100%;
	}

	.tool-call-permission-attachment {
		flex: 0 0 auto;
		max-width: 100%;
		width: fit-content;
	}
</style>
